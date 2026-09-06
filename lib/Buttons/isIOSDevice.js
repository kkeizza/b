
function isIOSDevice(sock) {
	const platform = (sock?.authState?.creds?.platform || '').toLowerCase()
	return platform === 'ios' || platform === 'smbi'
}

module.exports = { isIOSDevice }
