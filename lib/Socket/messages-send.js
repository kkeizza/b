
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const node_cache_1 = __importDefault(require("@cacheable/node-cache"));
const boom_1 = require("@hapi/boom");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const WABinary_1 = require("../WABinary");
const WAUSync_1 = require("../WAUSync");
const groups_1 = require("./groups");
const newsletter_1 = require("./newsletter");
const GiftedStatus = require("./gcstatus");
const crypto_1 = require("crypto");

const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: axiosOptions, patchMessageBeforeSending, cachedGroupMetadata } = config;
    const sock = (0, newsletter_1.makeNewsletterSocket)((0, groups_1.makeGroupsSocket)(config));
    const { ev, authState, processingMutex, signalRepository, upsertMessage, query, fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral } = sock;
    const userDevicesCache = config.userDevicesCache ||
        new node_cache_1.default({
            stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
            useClones: false
        });
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = (0, WABinary_1.getBinaryNodeChild)(result, 'media_conn');
                const node = {
                    hosts: (0, WABinary_1.getBinaryNodeChildren)(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };

    const sendReceipt = async (jid, participant, messageIds, type) => {
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0]
            }
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && (0, WABinary_1.isJidUser)(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };

    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };

    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };

    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        var _a;
        const deviceResults = [];
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        const toFetch = [];
        jids = Array.from(new Set(jids));
        for (let jid of jids) {
            const user = (_a = (0, WABinary_1.jidDecode)(jid)) === null || _a === void 0 ? void 0 : _a.user;
            jid = (0, WABinary_1.jidNormalizedUser)(jid);
            if (useCache) {
                const devices = userDevicesCache.get(user);
                if (devices) {
                    deviceResults.push(...devices);
                    logger.trace({ user }, 'using cache for devices');
                }
                else {
                    toFetch.push(jid);
                }
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length) {
            return deviceResults;
        }
        const query = new WAUSync_1.USyncQuery().withContext('message').withDeviceProtocol();
        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid));
        }
        const result = await sock.executeUSyncQuery(query);
        if (result) {
            const extracted = (0, Utils_1.extractDeviceJids)(result === null || result === void 0 ? void 0 : result.list, authState.creds.me.id, ignoreZeroDevices);
            const deviceMap = {};
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                deviceMap[item.user].push(item);
                deviceResults.push(item);
            }
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key]);
            }
        }
        return deviceResults;
    };

    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = jids.map(jid => signalRepository.jidToSignalProtocolAddress(jid));
            const sessions = await authState.keys.get('session', addrs);
            for (const jid of jids) {
                const signalId = signalRepository.jidToSignalProtocolAddress(jid);
                if (!sessions[signalId]) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid }
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
//
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        var _a;
        if (!((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.id)) {
            throw new boom_1.Boom('Not authenticated');
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force'
            }
        });
        return msgId;
    };

    const createParticipantNodes = async (jids, message, extraAttrs) => {
        let patched = await patchMessageBeforeSending(message, jids);
        if (!Array.isArray(patched)) {
            patched = jids ? jids.map(jid => ({ recipientJid: jid, ...patched })) : [patched];
        }
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(patched.map(async (patchedMessageWithJid) => {
            const { recipientJid: jid, ...patchedMessage } = patchedMessageWithJid;
            if (!jid) {
                return {};
            }
            const bytes = (0, Utils_1.encodeWAMessage)(patchedMessage);
            const { type, ciphertext } = await signalRepository.encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [
                    {
                        tag: 'enc',
                        attrs: {
                            v: '2',
                            type,
                            ...(extraAttrs || {})
                        },
                        content: ciphertext
                    }
                ]
            };
            return node;
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    };

    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList, AI = false }) => {
        var _a;
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        const { user, server } = (0, WABinary_1.jidDecode)(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isNewsletter = server === 'newsletter';
        // NOTE: AI defaults to false and is opt-in only. Setting it to true stamps a
        // <bot biz_bot="1"/> node onto the outgoing stanza for private chats -- the
        // tag WhatsApp uses to mark a message as forwarded from/via a bot (needed for
        // things like botForwardedMessage/richResponseMessage payloads sent through
        // relayMessage directly to be recognised as such). Leave it off for ordinary
        // messages, since tagging a normal message as bot-authored gets it stuck
        // rendering on the receiving end.
        const isPrivate = server === 's.whatsapp.net';
        msgId = msgId || (0, Utils_1.generateMessageIDV2)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = !isStatus ? (0, WABinary_1.jidEncode)(user, isLid ? 'lid' : isGroup ? 'g.us' : 's.whatsapp.net') : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            },
            messageContextInfo: message.messageContextInfo
        };
        const extraAttrs = {};
        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            }
            const { user, device } = (0, WABinary_1.jidDecode)(participant.jid);
            devices.push({ user, device });
        }
        await authState.keys.transaction(async () => {
            var _a, _b, _c, _d, _e;
            const mediaType = getMediaType(message);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            if (isNewsletter) {
                const patched = patchMessageBeforeSending ? await patchMessageBeforeSending(message, []) : message;
                const bytes = (0, Utils_1.encodeNewsletterMessage)(patched);
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: {},
                    content: bytes
                });
                const stanza = {
                    tag: 'message',
                    attrs: {
                        to: jid,
                        id: msgId,
                        type: getMessageType(message),
                        ...(additionalAttributes || {})
                    },
                    content: binaryNodeContent
                };
                logger.debug({ msgId }, `sending newsletter message to ${jid}`);
                await sendNode(stanza);
                return;
            }
            if ((_a = (0, Utils_1.normalizeMessageContent)(message)) === null || _a === void 0 ? void 0 : _a.pinInChatMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                        if (groupData && Array.isArray(groupData === null || groupData === void 0 ? void 0 : groupData.participants)) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]);
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                if (!participant) {
                    const participantsList = groupData && !isStatus ? groupData.participants.map(p => p.id) : [];
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList);
                    }
                    if (!isStatus) {
                        additionalAttributes = {
                            ...additionalAttributes,
                            addressing_mode: (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) || 'pn'
                        };
                    }
                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
                    devices.push(...additionalDevices);
                }
                const patched = await patchMessageBeforeSending(message);
                if (Array.isArray(patched)) {
                    throw new boom_1.Boom('Per-jid patching is not supported in groups');
                }
                const bytes = (0, Utils_1.encodeWAMessage)(patched);
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId
                });
                const senderKeyJids = [];
                for (const { user, device } of devices) {
                    const jid = (0, WABinary_1.jidEncode)(user, (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) === 'lid' ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        senderKeyMap[jid] = true;
                    }
                }
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg' },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else {
                const { user: meUser } = (0, WABinary_1.jidDecode)(meId);
                const meLid = (_b = (_c = authState.creds) === null || _c === void 0 ? void 0 : _c.me) === null || _b === void 0 ? void 0 : _b.lid;
                const meLidUser = meLid === null || meLid === void 0 ? void 0 : meLid.split(':')[0];
                const mePhone = meUser === null || meUser === void 0 ? void 0 : meUser.split(':')[0];
                
                if (!participant) {
                    devices.push({ user });
                    const isSelfMessage = user === meUser || user === mePhone || user === meLidUser;
                    if (!isSelfMessage) {
                        devices.push({ user: meUser });
                    }
                    if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) !== 'peer') {
                        const targetJid = isLid ? jid : (0, WABinary_1.jidNormalizedUser)(jid);
                        const additionalDevices = await getUSyncDevices([meId, targetJid], !!useUserDevicesCache, true);
                        devices.push(...additionalDevices);
                    }
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                for (const { user: deviceUser, device } of devices) {
                    const isMe = deviceUser === meUser || deviceUser === mePhone || deviceUser === meLidUser;
                    let encodedJid;
                    
                    if (isMe) {
                        encodedJid = (0, WABinary_1.jidEncode)(isLid ? meLidUser || mePhone : mePhone, isLid ? 'lid' : 's.whatsapp.net', device);
                    } else {
                        encodedJid = (0, WABinary_1.jidEncode)(deviceUser, isLid ? 'lid' : 's.whatsapp.net', device);
                    }
                    
                    if (isMe) {
                        meJids.push(encodedJid);
                    }
                    else {
                        otherJids.push(encodedJid);
                    }
                    allJids.push(encodedJid);
                }
                await assertSessions(allJids, false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs)
                ]);
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) === 'peer') {
                    const peerNode = (_e = (_d = participants[0]) === null || _d === void 0 ? void 0 : _d.content) === null || _e === void 0 ? void 0 : _e[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode);
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: getMessageType(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            if (participant) {
                if ((0, WABinary_1.isJidGroup)(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if ((0, WABinary_1.areJidsSameUser)(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (AI && isPrivate) {
                const hasBotNode = Array.isArray(additionalNodes) && additionalNodes.some(n => (n === null || n === void 0 ? void 0 : n.tag) === 'bot' && ((n === null || n === void 0 ? void 0 : n.attrs) || {}).biz_bot === '1');
                if (!hasBotNode) {
                    stanza.content.push({
                        tag: 'bot',
                        attrs: { biz_bot: '1' }
                    });
                    logger.debug({ jid }, 'adding bot node');
                }
            }
            if (additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
        });
        return msgId;
    };

    const getMessageType = (message) => {
        if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
            return 'poll';
        }
        return 'text';
    };

    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        }
        else if (message.contactMessage) {
            return 'vcard';
        }
        else if (message.documentMessage) {
            return 'document';
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array';
        }
        else if (message.liveLocationMessage) {
            return 'livelocation';
        }
        else if (message.stickerMessage) {
            return 'sticker';
        }
            else if (message.stickerPackMessage) {
    return 'sticker_pack';
            }
        else if (message.listMessage) {
            return 'list';
        }
        else if (message.listResponseMessage) {
            return 'list_response';
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        }
        else if (message.orderMessage) {
            return 'order';
        }
        else if (message.productMessage) {
            return 'product';
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        }
        else if (message.groupInviteMessage) {
            return 'url';
        }
        else if (message.groupStatusMessageV2) {
            const innerMsg = message.groupStatusMessageV2.message || {};
            if (innerMsg.imageMessage) return 'image';
            if (innerMsg.videoMessage) return innerMsg.videoMessage.gifPlayback ? 'gif' : 'video';
            if (innerMsg.audioMessage) return innerMsg.audioMessage.ptt ? 'ptt' : 'audio';
            if (innerMsg.stickerMessage) return 'sticker';
            return 'text';
        }
    };

    const getPrivacyTokens = async (jids) => {
        const t = (0, Utils_1.unixTimestampSeconds)().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: (0, WABinary_1.jidNormalizedUser)(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    };

    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    
    // FIXED: Changed from xmdStatus to giftedStatus
    const giftedStatus = new GiftedStatus(Utils_1, waUploadToServer, relayMessage, config, sock);
    
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');
    // ============ RICH MESSAGE METHODS ============
    /**
     * Send a table as a rich (AI-forwarded-style) message.
     * @param {string} jid
     * @param {{ headers: string[], rows: string[][] } | string[][] | [string, string, string]} table
     *   Accepts any of:
     *   - { headers: string[], rows: string[][] }
     *   - a 2D array: [[headers...], [row1...], [row2...]]
     *   - legacy flat array: [title, "h1|h2", "r1c1|r1c2;;r2c1|r2c2"]
     * @param {object} [quoted]
     * @param {object} [options]
     */
    const sendTable = async (jid, table, quoted, options = {}) => {
        const { message, messageId } = Utils_1.generateTableContentV2(table, quoted, options);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Send a list as a rich message.
     */
    const sendList = async (jid, title, items, quoted, options = {}) => {
        const { message, messageId } = Utils_1.generateListContent(title, items, quoted, options);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Send a syntax-highlighted code block as a rich message.
     * @param {string} jid
     * @param {string} code
     * @param {object} [quoted]
     * @param {object} [options] - { language }
     */
    const sendCodeBlock = async (jid, code, quoted, options = {}) => {
        const { message, messageId } = Utils_1.generateCodeBlockContentV2(code, quoted, options);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Send one or more links as a rich message.
     */
    const sendLink = async (jid, text, links, quoted, options = {}) => {
        const { message, messageId } = Utils_1.generateLinkContentV2(text, links, quoted, options);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Send a LaTeX expression as text metadata (renders client-side).
     */
    const sendLatex = async (jid, quoted, options = {}) => {
        const { message, messageId } = Utils_1.generateLatexContent(quoted, options);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Uploads a raw image buffer the same way updateCoverPhoto does, for use by the
     * LaTeX-image rich message senders below (waUploadToServer expects a file path
     * + its sha256, not a raw buffer).
     */
    const uploadRawImageBuffer = async (buffer, mediaType = 'image') => {
        const { fileSha256, filePath } = await Utils_1.getRawMediaUploadData(buffer, mediaType);
        return waUploadToServer(filePath, {
            fileEncSha256B64: fileSha256.toString('base64'),
            mediaType
        });
    };
    /**
     * Send LaTeX expressions rendered to images. Requires a renderLatexToPng(expr) => { buffer, width, height }
     * function to be supplied, since Baileys does not bundle a LaTeX renderer.
     */
    const sendLatexImage = async (jid, quoted, options = {}, renderLatexToPng) => {
        if (typeof renderLatexToPng !== 'function') {
            throw new boom_1.Boom('sendLatexImage requires a renderLatexToPng(expression) function to be passed in');
        }
        const { message, messageId } = await Utils_1.generateLatexImageContent(quoted, options, uploadRawImageBuffer, renderLatexToPng);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Send LaTeX expressions rendered inline as images. Requires the same renderLatexToPng function as sendLatexImage.
     */
    const sendLatexInlineImage = async (jid, quoted, options = {}, renderLatexToPng) => {
        if (typeof renderLatexToPng !== 'function') {
            throw new boom_1.Boom('sendLatexInlineImage requires a renderLatexToPng(expression) function to be passed in');
        }
        const { message, messageId } = await Utils_1.generateLatexInlineImageContent(quoted, options, uploadRawImageBuffer, renderLatexToPng);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Capture an outgoing/quoted rich (unified-response) message so it can later be re-sent verbatim.
     */
    const captureUnifiedResponse = Utils_1.captureUnifiedResponse;
    /**
     * Re-send a previously captured unified response message.
     */
    const sendUnifiedResponse = async (jid, quoted, captured) => {
        const { message, messageId } = Utils_1.generateUnifiedResponseContent(quoted, captured);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };
    /**
     * Send a rich message composed of multiple submessages (text/table/code/etc).
     */
    const sendRichMessage = async (jid, submessages, quoted, options = {}) => {
        const { message, messageId } = Utils_1.generateRichMessageContent(submessages, quoted);
        await relayMessage(jid, message, { messageId });
        return { message, messageId };
    };

    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
     //   sendStatusMentions,
        giftedStatus, // FIXED: Changed from xmdStatus to giftedStatus
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        sendTable,
        sendList,
        sendCodeBlock,
        sendLink,
        sendLatex,
        sendLatexImage,
        sendLatexInlineImage,
        captureUnifiedResponse,
        sendUnifiedResponse,
        sendRichMessage,
        updateMediaMessage: async (message) => {
            const content = (0, Utils_1.assertMediaContent)(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = await (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = await (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
                                if (media.result !== WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = WAProto_1.proto.MediaRetryNotification.ResultType[media.result];
                                    throw new boom_1.Boom(`Media re-upload failed by device (${resultStr})`, {
                                        data: media,
                                        statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404
                                    });
                                }
                                content.directPath = media.directPath;
                                content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [{ key: message.key, update: { message: message.message } }]);
            return message;
        },
        sendStatusMentions: async (content, jids = []) => {
    const userJid = (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id);
    let allUsers = new Set();
    allUsers.add(userJid);

    for (const id of jids) {
        const isGroup = (0, WABinary_1.isJidGroup)(id);
        const isPrivate = (0, WABinary_1.isJidUser)(id);

        if (isGroup) {
            try {
                const metadata = await cachedGroupMetadata(id) || await groupMetadata(id);
                const participants = metadata.participants.map(p => (0, WABinary_1.jidNormalizedUser)(p.id));
                participants.forEach(jid => allUsers.add(jid));
            } catch (error) {
                logger.error(`Error getting metadata for group ${id}: ${error}`);
            }
        } else if (isPrivate) {
            allUsers.add((0, WABinary_1.jidNormalizedUser)(id));
        }
    }

    const uniqueUsers = Array.from(allUsers);
    const getRandomHexColor = () => "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");

    const isMedia = content.image || content.video || content.audio;
    const isAudio = !!content.audio;

    const messageContent = { ...content };

    if (isMedia && !isAudio) {
        if (messageContent.text) {
            messageContent.caption = messageContent.text;
            delete messageContent.text;
        }
        delete messageContent.ptt;
        delete messageContent.font;
        delete messageContent.backgroundColor;
        delete messageContent.textColor;
    }

    if (isAudio) {
        delete messageContent.text;
        delete messageContent.caption;
        delete messageContent.font;
        delete messageContent.textColor;
    }

    const font = !isMedia ? (content.font || Math.floor(Math.random() * 9)) : undefined;
    const textColor = !isMedia ? (content.textColor || getRandomHexColor()) : undefined;
    const backgroundColor = (!isMedia || isAudio) ? (content.backgroundColor || getRandomHexColor()) : undefined;
    const ptt = isAudio ? (typeof content.ptt === 'boolean' ? content.ptt : true) : undefined;

    let msg;
    let mediaHandle;
    try {
        msg = await (0, Utils_1.generateWAMessage)(WABinary_1.STORIES_JID, messageContent, {
            logger,
            userJid,
            getUrlInfo: text => (0, link_preview_1.getUrlInfo)(text, {
                thumbnailWidth: linkPreviewImageThumbnailWidth,
                fetchOpts: {
                    timeout: 3000,
                    ...(axiosOptions || {})
                },
                logger,
                uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
            }),
            upload: async (encFilePath, opts) => {
                const up = await waUploadToServer(encFilePath, { ...opts });
                mediaHandle = up.handle;
                return up;
            },
            mediaCache: config.mediaCache,
            options: config.options,
            font,
            textColor,
            backgroundColor,
            ptt
        });
    } catch (error) {
        logger.error(`Error generating message: ${error}`);
        throw error;
    }

    await relayMessage(WABinary_1.STORIES_JID, msg.message, {
        messageId: msg.key.id,
        statusJidList: uniqueUsers,
        additionalNodes: [
            {
                tag: 'meta',
                attrs: {},
                content: [
                    {
                        tag: 'mentioned_users',
                        attrs: {},
                        content: jids.map(jid => ({
                            tag: 'to',
                            attrs: { jid: (0, WABinary_1.jidNormalizedUser)(jid) }
                        }))
                    }
                ]
            }
        ]
    });

    for (const id of jids) {
        try {
            const normalizedId = (0, WABinary_1.jidNormalizedUser)(id);
            const isPrivate = (0, WABinary_1.isJidUser)(normalizedId);
            const type = isPrivate ? 'statusMentionMessage' : 'groupStatusMentionMessage';

            const protocolMessage = {
                [type]: {
                    message: {
                        protocolMessage: {
                            key: msg.key,
                            type: 25
                        }
                    }
                },
                messageContextInfo: {
                    messageSecret: (0, crypto_1.randomBytes)(32)
                }
            };

            const statusMsg = await (0, Utils_1.generateWAMessageFromContent)(normalizedId,
                protocolMessage,
                {}
            );

            await relayMessage(
                normalizedId,
                statusMsg.message,
                {
                    additionalNodes: [{
                        tag: 'meta',
                        attrs: isPrivate ?
                            { is_status_mention: 'true' } :
                            { is_group_status_mention: 'true' }
                    }]
                }
            );

            await (0, Utils_1.delay)(2000);
        } catch (error) {
            logger.error(`Error sending to ${id}: ${error}`);
        }
    }

    return msg;
},
    sendMessage: async (jid, content, options = {}) => {
            var _a, _b, _c;
            const userJid = authState.creds.me.id;
            if (typeof content === 'object' &&
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' &&
                (0, WABinary_1.isJidGroup)(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean'
                    ? disappearingMessagesInChat
                        ? Defaults_1.WA_DEFAULT_EPHEMERAL
                        : 0
                    : disappearingMessagesInChat;
                await groupToggleEphemeral(jid, value);
            }
            // FIXED: Changed from xmdStatus to giftedStatus
            else if (typeof content === 'object' && content.groupStatusMessage) {
                return await giftedStatus.handleGroupStory(content, jid, options.quoted);
            }
                    
    else if (typeof content === 'object' && 'album' in content && Array.isArray(content.album)) {
        const albumMsg = await (0, Utils_1.prepareAlbumMessageContent)(jid, content.album, {
            sock: {
                relayMessage: relayMessage,
                waUploadToServer: waUploadToServer
            },
            userJid: userJid,
            ...options
        });
        
        for (const media of albumMsg) {
            await (0, Utils_1.delay)(options.delay || 500);
            await relayMessage(jid, media.message, { 
                messageId: media.key.id, 
                useCachedGroupMetadata: options.useCachedGroupMetadata,
                additionalAttributes: {},
                statusJidList: options.statusJidList,
                additionalNodes: options.additionalNodes
            });
        }
        
        return albumMsg;
    }
    
            else {
                const fullMsg = await (0, Utils_1.generateWAMessage)(jid, content, {
                    logger,
                    userJid,
                    getUrlInfo: text => (0, link_preview_1.getUrlInfo)(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...(axiosOptions || {})
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    getProfilePicUrl: sock.profilePictureUrl,
                    getCallLink: sock.createCallLink,
                    upload: waUploadToServer,
                    mediaCache: config.mediaCache,
                    options: config.options,
                    messageId: (0, Utils_1.generateMessageIDV2)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id),
                    ...options
                });
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isPollMessage = 'poll' in content && !!content.poll;
                const isAiMsg = 'ai' in content && !!content.ai;
                const additionalAttributes = {};
                const additionalNodes = [];
                if (isDeleteMsg) {
                    if ((0, WABinary_1.isJidGroup)((_b = content.delete) === null || _b === void 0 ? void 0 : _b.remoteJid) && !((_c = content.delete) === null || _c === void 0 ? void 0 : _c.fromMe)) {
                        additionalAttributes.edit = '8';
                    }
                    else {
                        additionalAttributes.edit = '7';
                    }
                }
                else if (isEditMsg) {
                    additionalAttributes.edit = '1';
                }
                else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                }
                else if (isPollMessage) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: {
                            polltype: 'creation'
                        }
                    });
                }
                if ('cachedGroupMetadata' in options) {
                    console.warn('cachedGroupMetadata in sendMessage are deprecated, now cachedGroupMetadata is part of the socket config.');
                }
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    useCachedGroupMetadata: options.useCachedGroupMetadata,
                    additionalAttributes,
                    statusJidList: options.statusJidList,
                    additionalNodes,
                    // only ever stamp the bot/AI tag when the caller explicitly asked
                    // for it via `content.ai` -- see the note on relayMessage's `AI`
                    // param default.
                    AI: isAiMsg
                });
                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                return fullMsg;
            }
        }
    };
};
exports.makeMessagesSocket = makeMessagesSocket;
