// sendInappSignup.js
// Convenience wrapper around btn.inappSignup() + sendButtons(), mirroring
// this common usage pattern:
//
//   async function sendInteractive(client, m, text) {
//     const device = await getDeviceMode()
//     if (device === 'ios') return client.sendMessage(m.chat, { text })
//     return client.sendMessage(m.chat, {
//       text, title, subtitle, footer,
//       interactiveButtons: [{ name: 'inapp_signup', buttonParamsJson: JSON.stringify({}) }]
//     })
//   }
//
// sendInappSignup() does the same iOS-fallback check (via isIOSDevice, so no
// separate getDeviceMode() lookup is needed) and sends a plain text message
// on iOS/SMB-iOS, or the full inapp_signup interactive message otherwise.

const { generateWAMessageFromContent } = require('../Utils')
const { isIOSDevice } = require('./isIOSDevice')
const { sendButtons } = require('./sendButtons')
const { btn } = require('./btn')

/**
 * Send an In-App Signup (Embedded Signup) interactive button message, with
 * an automatic plain-text fallback on iOS/SMB-iOS devices (which don't
 * render native flow buttons).
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {object} options
 * @param {string} options.text          Message body (used for both the
 *                                       interactive body and the iOS fallback)
 * @param {string} [options.title]       Header title
 * @param {string} [options.subtitle]    Header subtitle
 * @param {string} [options.footer]      Footer text
 * @param {string} [options.config_id]   Optional Meta Embedded Signup config_id
 * @param {object} [options.extra]       Extra fields merged into the button's buttonParamsJson
 * @param {object} [options.contextInfo]
 * @param {object} [options.quoted]
 */
async function sendInappSignup(sock, jid, options = {}) {
	const {
		text = '',
		title = '',
		subtitle = '',
		footer = '',
		config_id,
		extra = {},
		contextInfo,
		quoted
	} = options

	if (isIOSDevice(sock)) {
		const messageContent = { conversation: text }
		const fullMessage = generateWAMessageFromContent(jid, messageContent, {
			quoted,
			userJid: sock.user?.id
		})
		await sock.relayMessage(jid, fullMessage.message, {
			messageId: fullMessage.key.id
		})
		return fullMessage
	}

	return sendButtons(sock, jid, {
		text,
		title,
		subtitle,
		footer,
		buttons: [btn.inappSignup(config_id, extra)],
		contextInfo,
		quoted
	})
}

module.exports = { sendInappSignup }
