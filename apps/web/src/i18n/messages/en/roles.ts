export const roles = {
  'roles.createARole': 'Create a role',
  'roles.createRole': 'Create role',
  'roles.custom': 'Custom',
  'roles.delete': 'Delete “{name}”?',
  'roles.deleteRole': 'Delete role',
  'roles.editRole': 'Edit {name}',
  'roles.keysCannotChangeAfterCreation': 'Keys cannot change after creation.',
  'roles.lowercaseLettersNumbersOr': 'Lowercase letters, numbers, _ or -.',
  'roles.managedByThePlatform': 'Managed by the platform.',
  'roles.membersHoldingThisRoleWill':
    'Members holding this role will need a new one before they can keep working. This cannot be undone.',
  'roles.noDescription': 'No description.',
  'roles.noRolesFound': 'No roles found',
  'roles.permissionCount': { one: '{count} permission', other: '{count} permissions' },
  'roles.pickExactlyThePermissionsThis':
    'Pick exactly the permissions this role needs. You can change them later.',
  'roles.roleCreated': 'Role “{name}” created',
  'roles.roleDeleted': 'Role “{name}” deleted',
  'roles.roleSaved': 'Role “{name}” saved',
  'roles.roles': 'Roles',
  'roles.rolesBundlePermissionsSystemRoles':
    'Roles bundle permissions. System roles come with every organization; custom roles are yours to shape.',
  'roles.salesLead': 'Sales lead',
  'roles.salesLead2': 'sales_lead',
  'roles.selectAllPermissions': 'Select all {humanize} permissions',
  'roles.selected': '{length} selected',
  'roles.systemRolesAreManagedBy': 'System roles are managed by the platform and cannot be edited.',
  'roles.systemRolesShouldExistFor':
    'System roles should exist for every organization. If this persists, contact support.',
  'roles.thePermissionCatalogCouldNot':
    'The permission catalog could not be loaded. {getErrorMessage}',
  'roles.viewPermissions': 'View permissions',
  'roles.whatThisRoleIsFor': 'What this role is for',
} as const;
