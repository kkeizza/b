// sendAIRich.js
// Convenience wrapper + factory around the in-package `AIRich` builder (see
// airich.js). No longer depends on toxic-baileys -- AIRich is ported
// in-package and only needs standard Baileys plumbing (prepareWAMessageMedia
// + sock.waUploadToServer), sourced from `keithbaileys` (or the socket
// itself, if it exposes the helper directly).

const { AIRich } = require('./airich')

/**
 * Get a raw `AIRich` builder instance for manual chaining, e.g.:
 *   const rich = createAIRich(sock)
 *   await rich.addText('Hello').addCode('js', 'console.log(1)').send(jid)
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 */
function createAIRich(sock) {
	return new AIRich(sock)
}

function applyBlock(builder, block) {
	if (!block || typeof block !== 'object' || Array.isArray(block)) {
		throw new TypeError('keithbtn: each AIRich block must be a plain object with a `type`')
	}

	const opts = block.options || {}

	switch (block.type) {
		case 'text':
			builder.addText(block.text, opts)
			break
		case 'code':
			builder.addCode(block.language, block.code, opts)
			break
		case 'table':
			builder.addTable(block.table ?? block.rows, opts)
			break
		case 'image':
			builder.addImage(block.url ?? block.urls ?? block.image, opts)
			break
		case 'video':
			builder.addVideo(block.url ?? block.urls ?? block.video, opts)
			break
		case 'source':
			builder.addSource(block.sources, opts)
			break
		case 'reels':
			builder.addReels(block.data ?? block.items, opts)
			break
		case 'product':
			builder.addProduct(block.data ?? block.items, opts)
			break
		case 'post':
			builder.addPost(block.data ?? block.items, opts)
			break
		case 'tip':
			builder.addTip(block.text, opts)
			break
		case 'metadata':
			builder.addMetadata(block.text, opts)
			break
		case 'suggest':
			builder.addSuggest(block.suggestion, opts)
			break
		case 'widget':
			builder.addWidget(block.data ?? block.items, opts)
			break
		case 'footerAction':
			builder.addFooterAction(block.data ?? block.items, opts)
			break
		case 'submessage':
			builder.addSubmessage(block.data, opts)
			break
		case 'section':
			builder.addSection(block.data, opts)
			break
		default:
			throw new Error(`keithbtn: unknown AIRich block type "${block.type}"`)
	}
}

/**
 * Send an AI-rich response message using the in-package AIRich builder,
 * from a flat, ordered array of content blocks.
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {Array<object>} blocks  Ordered content blocks, e.g.:
 *   [
 *     { type: 'text', text: 'Here is what I found:' },
 *     { type: 'code', language: 'js', code: 'console.log(1)' },
 *     { type: 'table', rows: [['A', 'B'], ['1', '2']] },
 *     { type: 'source', sources: [['https://icon.png', 'https://example.com', 'Example']] },
 *     { type: 'tip', text: 'Tip: you can ask follow-up questions.' },
 *     { type: 'suggest', suggestion: ['Tell me more', 'Show an example'] }
 *   ]
 *   Supported types: text, code, table, image, video, source, reels,
 *   product, post, tip, metadata, suggest, widget, footerAction,
 *   submessage, section. Every block accepts an `options` object which is
 *   passed straight through to the underlying `add*` method -- most support
 *   `{ id, replace, insertAt }` for later editing/reordering via the raw
 *   builder (see `createAIRich`).
 * @param {object} [options]
 * @param {string} [options.title]        Shown as the bot disclaimer text
 * @param {string} [options.footer]       Appended as a final metadata-text section
 * @param {object} [options.contextInfo]
 * @param {object} [options.quoted]
 * @param {boolean} [options.forwarded]   Defaults to true (matches AIRich default)
 * @param {boolean} [options.notification]
 */
async function sendAIRich(sock, jid, blocks = [], options = {}) {
	if (!Array.isArray(blocks) || blocks.length === 0) {
		throw new Error('keithbtn: sendAIRich requires at least one content block')
	}

	const { title, footer, contextInfo, ...sendOptions } = options

	const builder = createAIRich(sock)

	if (title) builder.setTitle(title)
	if (footer) builder.setFooter(footer)
	if (contextInfo && typeof contextInfo === 'object') builder.setContextInfo(contextInfo)

	for (const block of blocks) applyBlock(builder, block)

	return builder.send(jid, sendOptions)
}

module.exports = { sendAIRich, createAIRich }
