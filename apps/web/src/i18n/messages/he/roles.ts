export const roles = {
  'roles.createARole': 'יצירת תפקיד',
  'roles.createRole': 'יצירת תפקיד',
  'roles.custom': 'מותאם אישית',
  'roles.delete': 'למחוק את “{name}”?',
  'roles.deleteRole': 'מחיקת תפקיד',
  'roles.editRole': 'עריכת {name}',
  'roles.keysCannotChangeAfterCreation': 'אי אפשר לשנות מפתחות לאחר היצירה.',
  'roles.lowercaseLettersNumbersOr': 'אותיות לטיניות קטנות, מספרים, _ או -.',
  'roles.managedByThePlatform': 'מנוהל על ידי הפלטפורמה.',
  'roles.membersHoldingThisRoleWill':
    'חברי צוות עם התפקיד הזה יצטרכו תפקיד חדש כדי להמשיך לעבוד. אי אפשר לבטל פעולה זו.',
  'roles.noDescription': 'אין תיאור.',
  'roles.noRolesFound': 'לא נמצאו תפקידים',
  'roles.permissionCount': { one: 'הרשאה אחת', two: 'שתי הרשאות', other: '{count} הרשאות' },
  'roles.pickExactlyThePermissionsThis':
    'בחרו בדיוק את ההרשאות שהתפקיד הזה צריך. אפשר לשנות אותן בהמשך.',
  'roles.roleCreated': 'התפקיד “{name}” נוצר',
  'roles.roleDeleted': 'התפקיד “{name}” נמחק',
  'roles.roleSaved': 'התפקיד “{name}” נשמר',
  'roles.roles': 'תפקידים',
  'roles.rolesBundlePermissionsSystemRoles':
    'תפקידים מקבצים הרשאות. תפקידי מערכת מגיעים עם כל ארגון; תפקידים מותאמים אישית אתם מעצבים בעצמכם.',
  'roles.salesLead': 'מוביל מכירות',
  'roles.salesLead2': 'sales_lead',
  'roles.selectAllPermissions': 'בחירת כל הרשאות {humanize}',
  'roles.selected': '{length} נבחרו',
  'roles.systemRolesAreManagedBy': 'תפקידי מערכת מנוהלים על ידי הפלטפורמה ואי אפשר לערוך אותם.',
  'roles.systemRolesShouldExistFor':
    'תפקידי מערכת אמורים להיות קיימים בכל ארגון. אם זה נמשך, פנו לתמיכה.',
  'roles.thePermissionCatalogCouldNot': 'לא ניתן היה לטעון את קטלוג ההרשאות. {getErrorMessage}',
  'roles.viewPermissions': 'צפייה בהרשאות',
  'roles.whatThisRoleIsFor': 'למה התפקיד הזה נועד',
} as const;
