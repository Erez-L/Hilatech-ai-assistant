import type { Message } from '../../translate';
import type { MessageKey } from '..';
import { agents } from './agents';
import { ai } from './ai';
import { analytics } from './analytics';
import { app } from './app';
import { assistant } from './assistant';
import { audit } from './audit';
import { auth } from './auth';
import { automation } from './automation';
import { automations } from './automations';
import { billing } from './billing';
import { common } from './common';
import { contacts } from './contacts';
import { conversations } from './conversations';
import { crm } from './crm';
import { dashboard } from './dashboard';
import { days } from './days';
import { errors } from './errors';
import { industry } from './industry';
import { integrations } from './integrations';
import { knowledge } from './knowledge';
import { leads } from './leads';
import { marketing } from './marketing';
import { meta } from './meta';
import { misc } from './misc';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { permission } from './permission';
import { permissionGroup } from './permissionGroup';
import { plan } from './plan';
import { roles } from './roles';
import { settings } from './settings';
import { shell } from './shell';
import { status } from './status';
import { team } from './team';
import { toolCategory } from './toolCategory';
import { ui } from './ui';
import { usage } from './usage';
import { validation } from './validation';

// Typed against the English key set: a missing or extra key is a compile error.
export const he: Record<MessageKey, Message> = {
  ...agents,
  ...ai,
  ...analytics,
  ...app,
  ...assistant,
  ...audit,
  ...auth,
  ...automation,
  ...automations,
  ...billing,
  ...common,
  ...contacts,
  ...conversations,
  ...crm,
  ...dashboard,
  ...days,
  ...errors,
  ...industry,
  ...integrations,
  ...knowledge,
  ...leads,
  ...marketing,
  ...meta,
  ...misc,
  ...nav,
  ...onboarding,
  ...permission,
  ...permissionGroup,
  ...plan,
  ...roles,
  ...settings,
  ...shell,
  ...status,
  ...team,
  ...toolCategory,
  ...ui,
  ...usage,
  ...validation,
};
