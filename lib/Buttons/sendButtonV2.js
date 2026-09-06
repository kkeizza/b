// sendButtonV2.js
// Convenience wrapper around the local `ButtonV2` builder (see buttonV2.js),
// mirroring sendButtons()/sendButtonsSafe(). Unlike the original version of
// this file, this no longer depends on toxic-baileys -- `ButtonV2` is now
// ported in-package and only needs `generateWAMessageFromContent` from your
// existing Baileys library (same source sendButtons.js already uses).

const { generateWAMessageFromContent } = require('../Utils')
const { ButtonV2 } = require('./buttonV2')

function normalizeButton(builder, b) {
	if (b == null) return

	// Simple string -> just display text, auto-generated id
	if (typeof b === 'string') {
		builder.addButton(b)
		return
	}

	if (typeof b !== 'object') {
		throw new TypeError('keithbtn: invalid button entry passed to sendButtonV2')
	}

	// Explicit raw baileys button object: { raw: { buttonId, buttonText: { displayText }, type } }
	// or already-shaped { buttonText: { displayText }, buttonId, type } passed directly.
	if (b.raw || b.buttonText !== undefined) {
		builder.addRawButton(b.raw || b)
		return
	}

	// { displayText, buttonId } / { text, id } shorthand
	const displayText = b.displayText ?? b.text ?? ''
	const buttonId = b.buttonId ?? b.id
	buttonId !== undefined ? builder.addButton(displayText, buttonId) : builder.addButton(displayText)
}

/**
 * Send a classic (headerType/buttonsMessage-style) button message using the
 * in-package ButtonV2 builder.
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {object} options
 * @param {string} [options.text]        Body text
 * @param {string} [options.footer]      Footer text
 * @param {Array}  options.buttons       Array of strings, { displayText, buttonId },
 *                                       or raw button objects ({ raw: {...} })
 * @param {string|Buffer} [options.thumbnail]  Image/url/buffer used as the header thumbnail
 * @param {object} [options.media]       Raw media payload passed straight to setMedia()
 * @param {object} [options.location]    { thumbnail, name, address } -> setLocation()
 * @param {object} [options.contextInfo]
 * @param {string[]} [options.mentions]
 * @param {object} [options.quoted]
 */
async function sendButtonV2(sock, jid, options = {}) {
	const {
		text = '',
		footer = '',
		buttons,
		thumbnail,
		media,
		location,
		contextInfo,
		mentions,
		quoted
	} = options

	if (!Array.isArray(buttons) || buttons.length === 0) {
		throw new Error('keithbtn: sendButtonV2 requires at least one button (pass `buttons`)')
	}

	const builder = new ButtonV2(sock, { generateWAMessageFromContent })

	if (text) builder.setBody(text)
	if (footer) builder.setFooter(footer)
	if (contextInfo && typeof contextInfo === 'object') builder.setContextInfo(contextInfo)

	for (const b of buttons) normalizeButton(builder, b)

	if (media && typeof media === 'object') {
		builder.setMedia(media)
	} else if (location && typeof location === 'object') {
		await builder.setLocation(location.thumbnail, location.name, location.address)
	} else if (thumbnail) {
		builder.setThumbnail(thumbnail)
	}

	return builder.send(jid, {
		mentions,
		quoted,
		userJid: sock.user?.id
	})
}

module.exports = { sendButtonV2, ButtonV2 }
