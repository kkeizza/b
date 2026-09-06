const { generateWAMessageFromContent } = require('../Utils')

async function sendButtons(sock, jid, options = {}) {
	const {
		text = '',
		footer = '',
		title,
		subtitle,
		buttons,
		interactiveButtons,
		contextInfo,
		quoted
	} = options

	const resolvedButtons = buttons || interactiveButtons || []

	if (!Array.isArray(resolvedButtons) || resolvedButtons.length === 0) {
		throw new Error('keithbtn: sendButtons requires at least one button (pass `buttons` or `interactiveButtons`)')
	}

	for (const b of resolvedButtons) {
		if (!b || typeof b.name !== 'string' || typeof b.buttonParamsJson !== 'string') {
			throw new Error('keithbtn: each button needs { name, buttonParamsJson } -- use the btn.* builders')
		}
	}

	const bodyAndHeader = {
		header: { title: title || '', subtitle: subtitle || '', hasMediaAttachment: false },
		...(text ? { body: { text } } : {}),
		...(footer ? { footer: { text: footer } } : {})
	}

	if (contextInfo && typeof contextInfo === 'object') {
		bodyAndHeader.contextInfo = contextInfo
	}

	const interactiveMessage = {
		...bodyAndHeader,
		nativeFlowMessage: {
			buttons: resolvedButtons,
			messageParamsJson: ''
		}
	}

	const messageContent = { interactiveMessage }

	const interactiveStanzaNodes = [
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
	]

	const fullMessage = generateWAMessageFromContent(jid, messageContent, {
		quoted,
		userJid: sock.user?.id
	})

	await sock.relayMessage(jid, fullMessage.message, {
		messageId: fullMessage.key.id,
		additionalNodes: interactiveStanzaNodes
	})

	return fullMessage
}

const sendInteractiveMessage = sendButtons

module.exports = { sendButtons, sendInteractiveMessage }
