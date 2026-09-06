

'use strict'

const crypto = require('crypto')

let _generateWAMessageFromContent
function getGenerateWAMessageFromContent(sock) {
	if (_generateWAMessageFromContent) return _generateWAMessageFromContent
	if (typeof sock?.generateWAMessageFromContent === 'function') {
		_generateWAMessageFromContent = sock.generateWAMessageFromContent
		return _generateWAMessageFromContent
	}
	try {
		;({ generateWAMessageFromContent: _generateWAMessageFromContent } = require('../../Utils'))
	} catch (err) {
		throw new Error(
			'keithbtn: AIRich requires `generateWAMessageFromContent` from your Baileys library. ' +
			`Original error: ${err.message}`
		)
	}
	return _generateWAMessageFromContent
}

let _prepareWAMessageMedia
function getPrepareWAMessageMedia(sock) {
	if (_prepareWAMessageMedia) return _prepareWAMessageMedia
	if (typeof sock?.prepareWAMessageMedia === 'function') {
		_prepareWAMessageMedia = sock.prepareWAMessageMedia
		return _prepareWAMessageMedia
	}
	try {
		;({ prepareWAMessageMedia: _prepareWAMessageMedia } = require('../../Utils'))
	} catch (err) {
		throw new Error(
			'keithbtn: AIRich media features (addImage/addVideo/addSource/addProduct/addPost/addReels) ' +
			`require \`prepareWAMessageMedia\` from your Baileys library. Original error: ${err.message}`
		)
	}
	return _prepareWAMessageMedia
}

let _generateMessageIDV2
function getGenerateMessageIDV2(sock) {
	if (_generateMessageIDV2) return _generateMessageIDV2
	if (typeof sock?.generateMessageIDV2 === 'function') {
		_generateMessageIDV2 = sock.generateMessageIDV2
		return _generateMessageIDV2
	}
	try {
		;({ generateMessageIDV2: _generateMessageIDV2 } = require('../../Utils'))
		if (typeof _generateMessageIDV2 === 'function') return _generateMessageIDV2
	} catch {
		// fall through to the local fallback below
	}
	// Fallback: not every fork exports generateMessageIDV2 under that exact
	// name. A random hex ID is an acceptable substitute -- WhatsApp only
	// requires message IDs to be unique, not to follow a specific format.
	_generateMessageIDV2 = () => crypto.randomBytes(16).toString('hex').toUpperCase()
	return _generateMessageIDV2
}

let _sharp = null
async function getSharp() {
	if (_sharp) return _sharp
	try {
		_sharp = (await import('sharp')).default
		return _sharp
	} catch {}
	return null
}

let _ffmpeg = null
async function getFfmpeg() {
	if (_ffmpeg) return _ffmpeg
	try {
		_ffmpeg = (await import('fluent-ffmpeg')).default
		return _ffmpeg
	} catch {}
	return null
}

module.exports = {
	getGenerateWAMessageFromContent,
	getPrepareWAMessageMedia,
	getGenerateMessageIDV2,
	getSharp,
	getFfmpeg,
}
