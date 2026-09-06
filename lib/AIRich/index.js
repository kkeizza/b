"use strict";
// AI-rich response message builder (tables, code blocks, sources, images,
// etc. -- the WhatsApp bot-forwarded rich response format), ported
// in-package from the standalone "keithbtn" companion package so
// keithbaileys ships with this built in and no longer needs it as a
// separate dependency.
Object.defineProperty(exports, "__esModule", { value: true });
const { AIRich, Toolkit, BaseBuilder, VERSION, AIRichError, ItemNotFoundError, DuplicateIdError, InvalidTargetError, ContentValidationError } = require('./airich');
const { sendAIRich, createAIRich } = require('./sendAIRich');

exports.AIRich = AIRich;
exports.Toolkit = Toolkit;
exports.BaseBuilder = BaseBuilder;
exports.AIRICH_VERSION = VERSION;
exports.AIRichError = AIRichError;
exports.ItemNotFoundError = ItemNotFoundError;
exports.DuplicateIdError = DuplicateIdError;
exports.InvalidTargetError = InvalidTargetError;
exports.ContentValidationError = ContentValidationError;
exports.sendAIRich = sendAIRich;
exports.createAIRich = createAIRich;
