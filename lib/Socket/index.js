"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Defaults_1 = require("../Defaults");
const communities_1 = require("./communities");
const Buttons_1 = require("../Buttons");
const AIRich_1 = require("../AIRich");
// export the last socket layer
const makeWASocket = (config) => {
    const sock = (0, communities_1.makeCommunitiesSocket)({
        ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
        ...config
    });
    return {
        ...sock,
        // interactive buttons + AI-rich response messages, ported in-package
        // from the standalone "keithbtn" companion package -- bound here so
        // they're available directly as sock.sendButtons(jid, ...), etc.,
        // without needing to pass `sock` in yourself. See README.md.
        sendButtons: (jid, options) => (0, Buttons_1.sendButtons)(sock, jid, options),
        sendInteractiveMessage: (jid, options) => (0, Buttons_1.sendInteractiveMessage)(sock, jid, options),
        sendButtonsSafe: (jid, options) => (0, Buttons_1.sendButtonsSafe)(sock, jid, options),
        sendInappSignup: (jid, options) => (0, Buttons_1.sendInappSignup)(sock, jid, options),
        sendButtonV2: (jid, options) => (0, Buttons_1.sendButtonV2)(sock, jid, options),
        sendAIRich: (jid, blocks, options) => (0, AIRich_1.sendAIRich)(sock, jid, blocks, options),
        createAIRich: () => (0, AIRich_1.createAIRich)(sock)
    };
};
exports.default = makeWASocket;

