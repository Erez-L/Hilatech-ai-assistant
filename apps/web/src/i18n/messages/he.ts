import type { Message } from '../translate';
import type { MessageKey } from './index';
import { he as heMessages } from './he/index';

// Typed against the English key set: a missing or extra key is a compile error.
export const he: Record<MessageKey, Message> = heMessages;
