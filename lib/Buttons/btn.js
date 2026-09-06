const btn = {
	url(display_text, url, merchant_url) {
		return {
			name: 'cta_url',
			buttonParamsJson: JSON.stringify({
				display_text,
				url,
				merchant_url: merchant_url || url
			})
		}
	},

	copy(display_text, copy_code) {
		return {
			name: 'cta_copy',
			buttonParamsJson: JSON.stringify({
				display_text,
				copy_code
			})
		}
	},

	call(display_text, phone_number) {
		return {
			name: 'cta_call',
			buttonParamsJson: JSON.stringify({ display_text, phone_number })
		}
	},

	reply(display_text, id) {
		return {
			name: 'quick_reply',
			buttonParamsJson: JSON.stringify({ display_text, id })
		}
	},

	reminder(display_text, id) {
		return {
			name: 'cta_reminder',
			buttonParamsJson: JSON.stringify({ display_text, id })
		}
	},

	cancelReminder(display_text, id) {
		return {
			name: 'cta_cancel_reminder',
			buttonParamsJson: JSON.stringify({ display_text, id })
		}
	},

	address(display_text, id) {
		return {
			name: 'address_message',
			buttonParamsJson: JSON.stringify({ display_text, id })
		}
	},

	location(options = {}) {
		return {
			name: 'send_location',
			buttonParamsJson: JSON.stringify(options)
		}
	},

	list(list_button_text, sections) {
		return {
			name: 'single_select',
			buttonParamsJson: JSON.stringify({ title: list_button_text, sections })
		}
	},

	inappSignup(config_id, extra = {}) {
		if (config_id !== undefined && typeof config_id !== 'string') {
			throw new TypeError('keithbtn: btn.inappSignup config_id must be a string when provided')
		}
		const payload = { ...(config_id ? { config_id } : {}), ...extra }
		return {
			name: 'inapp_signup',
			buttonParamsJson: JSON.stringify(payload)
		}
	}
}

module.exports = { btn }
