# keithbaileys

A WhatsApp Web API library.

## Table of contents

- [Bot / "AI"-forwarded message tagging](#bot--ai-forwarded-message-tagging-contentai--ai-option)
- [Interactive buttons](#interactive-buttons)
- [AI-rich response messages (tables, code blocks, sources, etc.)](#ai-rich-response-messages-tables-code-blocks-sources-etc)
- [Protobuf schema update (WAProto)](#protobuf-schema-update-waproto)

## Bot / "AI"-forwarded message tagging (`content.ai` / `AI` option)

`relayMessage` and `sendMessage` now support an opt-in flag that stamps a `<bot biz_bot="1"/>` node onto the outgoing stanza for private (1:1) chats — the tag WhatsApp uses to mark a message as coming from/via a bot. This is what's needed for things like `botForwardedMessage` / `richResponseMessage` payloads (rich AI-bot-style responses) to be recognized as such when sent through `relayMessage` directly.

It's off by default, so ordinary messages are never tagged.

Via `sendMessage`:

```js
await sock.sendMessage(jid, { text: 'hi', ai: true });
```

Via `relayMessage` directly (e.g. when building a raw bot-forwarded/rich-response payload yourself):

```js
await sock.relayMessage(jid, content, { AI: true });
```

If you construct `additionalNodes` yourself and it already contains a `<bot biz_bot="1"/>` entry, this won't add a duplicate — your own node is used as-is.

Leave `AI`/`content.ai` unset (or `false`) for normal messages; tagging a normal message as bot-authored can make it fail to render correctly on the receiving end.

## Interactive buttons

Ported in-package from the standalone `keithbtn` companion package, so it's no longer a separate dependency — just `require('keithbaileys')`.

**Migrating from `keithbtn`:** every function below (`btn`, `sendButtons`, `sendButtonsSafe`, `sendInappSignup`, `sendButtonV2`, `ButtonV2`) keeps the exact same name and signature — `fn(sock, jid, options)`. If you were doing this:

```js
const { sendInappSignup } = require('keithbtn');
await sendInappSignup(client, from, { text: '...' });
```

just change the import line:

```js
const { sendInappSignup } = require('keithbaileys'); // was: require('keithbtn')
await sendInappSignup(client, from, { text: '...' }); // unchanged
```

Nothing else in your code needs to change. If you'd rather not import the function separately, every one of these is also available as a bound method directly on the socket (`client.sendInappSignup(from, { text: '...' })`) — both styles work and call the same code.

### Quick reply / CTA buttons (`sendButtons`)

```js
const { btn } = require('keithbaileys');

await sock.sendButtons(jid, {
  text: 'Pick one:',
  footer: 'powered by keithbaileys',
  buttons: [
    btn.reply('Option A', 'opt_a'),
    btn.reply('Option B', 'opt_b'),
    btn.url('Visit site', 'https://example.com'),
    btn.copy('Copy code', 'ABC123'),
    btn.call('Call us', '+15551234567')
  ]
});
```

`btn` also provides `reminder`, `cancelReminder`, `address`, `location`, `list`, and `inappSignup` builders — each returns a `{ name, buttonParamsJson }` pair `sendButtons` (or your own `interactiveMessage`) expects.

`sendButtonsSafe` does the same thing, but automatically falls back to a plain text message on iOS/SMB-iOS devices (which don't render native flow buttons):

```js
await sock.sendButtonsSafe(jid, { text: 'Pick one:', buttons: [btn.reply('OK', 'ok')] });
```

`sendInappSignup` is a convenience wrapper around `btn.inappSignup()` with the same iOS fallback:

```js
await sock.sendInappSignup(jid, { text: 'Connect your account', config_id: 'your-config-id' });
```

### Classic buttons (`sendButtonV2` / `ButtonV2`)

For the older `buttonsMessage` shape (optionally with a thumbnail/location header):

```js
await sock.sendButtonV2(jid, {
  text: 'Choose an option',
  footer: 'footer text',
  buttons: ['Yes', 'No', { displayText: 'Maybe', buttonId: 'maybe_1' }],
  thumbnail: 'https://example.com/image.jpg' // optional; used as sharp is installed, otherwise sent as-is
});
```

Or build one manually with the `ButtonV2` class for full control (`setTitle`, `setBody`, `setFooter`, `addButton`, `setThumbnail`, `setLocation`, `setMedia`, `.send(jid)`):

```js
const { ButtonV2, generateWAMessageFromContent } = require('keithbaileys');

const builder = new ButtonV2(sock, { generateWAMessageFromContent });
builder.setBody('Choose an option').addButton('Yes', 'yes_1').addButton('No', 'no_1');
await builder.send(jid);
```

`sharp` is used for thumbnail/location image resizing if installed, and skipped (raw buffer sent as-is) if it isn't — it's optional, not required.

## AI-rich response messages (tables, code blocks, sources, etc.)

Ported in-package from the standalone `keithbtn` companion package's `AIRich` builder. This produces the same `botForwardedMessage` / `richResponseMessage` payload shape covered in the [protobuf schema update](#protobuf-schema-update-waproto) section above, and requires that schema fix to actually render on the receiving end (it does, in this package).

**Migrating from `keithbtn`:** same deal as buttons above — `sendAIRich`/`createAIRich`/`AIRich` keep the same names and signatures, so `require('keithbtn')` → `require('keithbaileys')` is the only change needed.

This is a separate, independent API from this package's own native `sendRichMessage`/`generateTableContent` helpers (see `Utils/rich-messages.js`) — both work, `AIRich` just offers a broader, chainable builder (tables, code blocks with syntax highlighting, images/video, source links, product/post/reels cards, tips, suggestions, and more).

### One-shot: `sendAIRich`

```js
await sock.sendAIRich(jid, [
  { type: 'text', text: 'Here is what I found:' },
  { type: 'table', table: [
    ['Name', 'Score'],
    ['Alice', '92'],
    ['Bob', '87']
  ]},
  { type: 'code', language: 'js', code: "console.log('hello')" },
  { type: 'source', sources: [['https://icon.png', 'https://example.com', 'Example']] },
  { type: 'tip', text: 'Tip: you can ask follow-up questions.' },
  { type: 'suggest', suggestion: ['Tell me more', 'Show an example'] }
], {
  title: 'My Bot',   // shown as the bot disclaimer text
  footer: 'Generated by keithbaileys'
});
```

Supported block `type`s: `text`, `code`, `table`, `image`, `video`, `source`, `reels`, `product`, `post`, `tip`, `metadata`, `suggest`, `widget`, `footerAction`, `submessage`, `section`. Every block accepts an `options` object passed straight through to the underlying builder method.

### Chainable builder: `createAIRich` / `AIRich`

```js
const rich = sock.createAIRich(); // or: new (require('keithbaileys').AIRich)(sock)

await rich
  .addText('Here is what I found:')
  .addTable([['Name', 'Score'], ['Alice', '92']])
  .addCode('js', "console.log('hello')")
  .addTip('Tip: you can ask follow-up questions.')
  .send(jid);
```

`AIRich` also supports `loadFrom(msg)` (to re-hydrate a builder from a previously sent/received rich message for editing), `sendEdit(jid, id, ...)`, `addImage`/`addVideo`/`addSource`/`addProduct`/`addPost`/`addReels` (media-based blocks — these need `prepareWAMessageMedia`, already available from this package), and ID-based `replace`/`insertAt` options on every `add*` method for reordering/editing content before sending.

## Protobuf schema update (WAProto)

`WAProto/index.js` has been replaced with a newer, more complete generated schema. The previous schema in this package was simply missing several `Message` fields entirely — most notably `botForwardedMessage` — which meant any payload built around them (e.g. `botForwardedMessage.message.richResponseMessage`, used for bot-style rich response / AI-forwarded messages) was silently dropped during protobuf encoding, regardless of any stanza-level tagging like the `AI`/`bot` node above. protobufjs only serializes properties that exist as defined fields on the schema; everything else is quietly discarded.

The new schema is a strict superset of the old one — every class/enum this package's own code already depended on (`Message`, `WebMessageInfo`, `ClientPayload`, `ADVSignedDeviceIdentity`, `SyncdMutation`, etc.) is still present and unchanged, plus additional fields/messages including `botForwardedMessage`, expanded `BotMetadata`, `AIRichResponseMessage`/`AIRichResponseSubMessage`/`AIRichResponseUnifiedResponse`, and `ContextInfo.forwardedAiBotMessageInfo`.

Note: `WAProto/WAProto.proto` (the human-readable `.proto` source used only for documentation/regeneration via `GenerateStatics.sh`, not at runtime) was **not** updated to match, since this package doesn't ship a corresponding newer `.proto` source. If you regenerate `index.js` from that file, you'll lose the newer fields — treat `index.js` as the current source of truth until the `.proto` file is updated too.
