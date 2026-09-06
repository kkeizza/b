const { generateWAMessageFromContent } = require('../Utils')
const { isIOSDevice } = require('./isIOSDevice')
const { sendButtons } = require('./sendButtons')

async function sendButtonsSafe(sock, jid, options = {}) {
	if (isIOSDevice(sock)) {
		const text = options.text || options.footer || ''
		const messageContent = { conversation: text }
		const fullMessage = generateWAMessageFromContent(jid, messageContent, {
			quoted: options.quoted,
			userJid: sock.user?.id
		})
		await sock.relayMessage(jid, fullMessage.message, {
			messageId: fullMessage.key.id
		})
		return fullMessage
	}

	return sendButtons(sock, jid, options)
}

module.exports = { sendButtonsSafe }
