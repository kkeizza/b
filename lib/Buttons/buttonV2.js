// buttonV2.js
//
// A self-contained port of the `ButtonV2` builder originally found in
// toxic-baileys (WABuilder/index.js). It's ported directly into keithbtn so
// this package does NOT need toxic-baileys as a dependency -- avoiding its
// jimp/sharp/etc peer-dependency footprint and any version clashes with
// whatever Baileys fork you're already using.
//
// The only thing this needs from your Baileys socket library is the
// standard `generateWAMessageFromContent` utility, which is present in
// essentially every Baileys fork (WhiskeySockets/Baileys, keithbaileys,
// toxic-baileys, etc.) with an identical signature -- it's core WAProto
// message-wrapping logic, not something toxic-baileys added.
//
// Image resizing (setThumbnail/setLocation) uses `sharp` if it's installed,
// and silently skips resizing (sending the raw buffer) if it isn't --
// sharp is optional, not required, to keep this dependency-light.

const crypto = require('crypto')

function randomId() {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
	// Fallback UUID v4 for very old Node versions without crypto.randomUUID
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

let _sharp
function loadSharp() {
	if (_sharp !== undefined) return _sharp
	try {
		_sharp = require('sharp')
	} catch {
		_sharp = null
	}
	return _sharp
}

async function resizeImage(buffer, width, height, fit = 'cover') {
	const sharp = loadSharp()
	if (!sharp || !buffer || !buffer.length) return buffer
	try {
		return await sharp(buffer)
			.resize(width, height, {
				fit,
				position: 'center',
				background: { r: 0, g: 0, b: 0, alpha: 0 }
			})
			.png()
			.toBuffer()
	} catch {
		// If sharp is present but the buffer isn't a valid image (or any
		// other resize failure), fall back to the original buffer rather
		// than throwing -- matches toxic-baileys' fail-soft behavior.
		return buffer
	}
}

async function fetchBuffer(url, options = {}, { silent = true } = {}) {
	try {
		const response = await fetch(url, options)
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return Buffer.from(await response.arrayBuffer())
	} catch (err) {
		if (silent) return Buffer.alloc(0)
		throw err
	}
}

async function toBuffer(input) {
	if (!input) return Buffer.alloc(0)
	if (Buffer.isBuffer(input)) return input
	return fetchBuffer(input, {}, { silent: true })
}

class ButtonV2 {
	constructor(client, { generateWAMessageFromContent } = {}) {
		if (!client) {
			throw new Error('keithbtn: ButtonV2 requires a Baileys-compatible socket')
		}
		if (typeof generateWAMessageFromContent !== 'function') {
			throw new Error(
				'keithbtn: ButtonV2 requires `generateWAMessageFromContent` from your Baileys library. ' +
				'Pass it explicitly, e.g. new ButtonV2(sock, { generateWAMessageFromContent }).'
			)
		}
		this._client = client
		this._generateWAMessageFromContent = generateWAMessageFromContent
		this._title = ''
		this._subtitle = ''
		this._body = ''
		this._footer = ''
		this._contextInfo = {}
		this._extraPayload = {}
		this._buttons = []
		this._image = undefined
		this._data = undefined
	}

	setTitle(title) {
		if (typeof title !== 'string') throw new TypeError('Title must be a string')
		this._title = title
		return this
	}

	setSubtitle(subtitle) {
		if (typeof subtitle !== 'string') throw new TypeError('Subtitle must be a string')
		this._subtitle = subtitle
		return this
	}

	setBody(body) {
		if (typeof body !== 'string') throw new TypeError('Body must be a string')
		this._body = body
		return this
	}

	setFooter(footer) {
		if (typeof footer !== 'string') throw new TypeError('Footer must be a string')
		this._footer = footer
		return this
	}

	setContextInfo(obj) {
		if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
			throw new TypeError('ContextInfo must be a plain object')
		}
		this._contextInfo = obj
		return this
	}

	addPayload(obj) {
		if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
			throw new TypeError('Payload must be a plain object')
		}
		Object.assign(this._extraPayload, obj)
		return this
	}

	addButton(displayText = '', buttonId = randomId()) {
		this._buttons.push({
			buttonId,
			buttonText: { displayText },
			type: 1
		})
		return this
	}

	addRawButton(obj) {
		if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
			throw new TypeError('Buttons must be a plain object')
		}
		this._buttons.push(obj)
		return this
	}

	setThumbnail(path) {
		if (!path) throw new Error('Url or buffer needed')
		this._image = path
		return this
	}

	setMedia(obj) {
		if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
			throw new TypeError('Media must be a plain object')
		}
		this._data = obj
		return this
	}

	async setLocation(thumbnail, name = '', address = '') {
		let jpegThumbnail = null
		if (thumbnail) {
			const buf = await toBuffer(thumbnail)
			if (buf.length > 0) jpegThumbnail = await resizeImage(buf, 300, 300)
		}
		this._title = name
		this._subtitle = address
		this._image = jpegThumbnail
		return this
	}

	async build(jid, { mentions, ...options } = {}) {
		const thumbnail = this._image
			? await resizeImage(await toBuffer(this._image), 300, 300)
			: null

		const contextInfo = { ...this._contextInfo }
		if (mentions?.length) contextInfo.mentionedJid = mentions

		const msg = this._generateWAMessageFromContent(
			jid,
			{
				...this._extraPayload,
				buttonsMessage: {
					contentText: this._body,
					footerText: this._footer,
					...(this._data
						? this._data
						: {
							headerType: 6,
							locationMessage: {
								degreesLatitude: 0,
								degreesLongitude: 0,
								name: this._title,
								address: this._subtitle,
								jpegThumbnail: thumbnail
							}
						}),
					viewOnce: true,
					contextInfo,
					buttons: [...this._buttons]
				}
			},
			{ ...options }
		)
		return msg
	}

	async send(jid, { ...options } = {}) {
		if (this._buttons.length < 1) {
			throw new Error('ButtonV2 requires at least one button')
		}
		const msg = await this.build(jid, options)
		await this._client.relayMessage(msg.key.remoteJid, msg.message, {
			messageId: msg.key.id,
			additionalNodes: [
				{
					tag: 'biz',
					attrs: {},
					content: [
						{
							tag: 'interactive',
							attrs: { type: 'native_flow', v: '1' },
							content: [
								{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }
							]
						}
					]
				}
			],
			...options
		})
		return msg
	}

	async run(jid, sock, options = {}) {
		return this.send(jid, options)
	}
}

module.exports = { ButtonV2 }
