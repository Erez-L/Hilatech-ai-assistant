/** Display texts for items the API describes in English only: agent tools and workflow templates. */
export const catalog = {
  'catalog.tool.crm.search_contacts.name': 'חיפוש אנשי קשר',
  'catalog.tool.crm.search_contacts.description':
    'מאתר אנשי קשר בארגון לפי שם, אימייל, טלפון או חברה.',
  'catalog.tool.crm.get_contact.name': 'פרטי איש קשר',
  'catalog.tool.crm.get_contact.description': 'טוען איש קשר אחד עם הלידים והשיחות האחרונים שלו.',
  'catalog.tool.crm.create_contact.name': 'יצירת איש קשר',
  'catalog.tool.crm.create_contact.description': 'יוצר איש קשר חדש בארגון.',
  'catalog.tool.crm.search_leads.name': 'חיפוש לידים',
  'catalog.tool.crm.search_leads.description':
    'מציג לידים, עם סינון לפי טקסט, שלב או אחראי. המעודכנים ביותר מופיעים ראשונים.',
  'catalog.tool.crm.get_lead.name': 'פרטי ליד',
  'catalog.tool.crm.get_lead.description':
    'טוען ליד אחד עם איש הקשר, ההערות האחרונות והפעילות האחרונה.',
  'catalog.tool.crm.create_lead.name': 'יצירת ליד',
  'catalog.tool.crm.create_lead.description': 'יוצר ליד חדש, עם אפשרות לקשר אותו לאיש קשר קיים.',
  'catalog.tool.crm.update_lead_status.name': 'עדכון שלב של ליד',
  'catalog.tool.crm.update_lead_status.description':
    'מעביר ליד לשלב אחר (חדש, נוצר קשר, מתאים, הצעה, נסגר בהצלחה, אבד).',
  'catalog.tool.crm.add_lead_note.name': 'הוספת הערה לליד',
  'catalog.tool.crm.add_lead_note.description': 'מוסיף הערה לליד, למשל סיכום שיחה או הצעד הבא.',
  'catalog.tool.crm.list_conversations.name': 'רשימת שיחות',
  'catalog.tool.crm.list_conversations.description':
    'מציג שיחות עם לקוחות, עם סינון לפי סטטוס, איש קשר או ליד.',
  'catalog.tool.crm.get_conversation_messages.name': 'הודעות בשיחה',
  'catalog.tool.crm.get_conversation_messages.description':
    'קורא את ההודעות האחרונות בשיחה עם לקוח, מהישנה לחדשה.',
  'catalog.tool.time.now.name': 'השעה הנוכחית',
  'catalog.tool.time.now.description': 'מחזיר את התאריך, השעה והיום בשבוע.',
  'catalog.tool.knowledge.search.name': 'חיפוש במאגר הידע',
  'catalog.tool.knowledge.search.description':
    'מחפש לפי משמעות במסמכים שהועלו לארגון, ומחזיר את הקטעים הרלוונטיים ביותר עם המקור שלהם.',
  'catalog.tool.tasks.list.name': 'רשימת משימות',
  'catalog.tool.tasks.list.description':
    'מציג משימות בארגון, עם סינון לפי סטטוס, אחראי, רשומה מקושרת או איחור.',
  'catalog.tool.tasks.create.name': 'יצירת משימה',
  'catalog.tool.tasks.create.description':
    'יוצר משימה, עם אפשרות לקשר אותה לליד, איש קשר, עסקה או שיחה, ולקבוע תאריך יעד ותזכורת.',
  'catalog.tool.deals.list.name': 'רשימת עסקאות',
  'catalog.tool.deals.list.description':
    'מציג עסקאות עם השלב שלהן בצינור המכירה, עם סינון לפי סטטוס, שלב, בעלים, איש קשר או טקסט.',
  'catalog.tool.deals.create.name': 'יצירת עסקה',
  'catalog.tool.deals.create.description':
    'יוצר עסקה בצינור מכירה. בלי בחירה אחרת, בצינור ברירת המחדל ובשלב הפתוח הראשון.',
  'catalog.tool.deals.move.name': 'העברת עסקה',
  'catalog.tool.deals.move.description':
    'מעביר עסקה לשלב אחר בצינור. מעבר לשלב של זכייה או הפסד סוגר את העסקה.',
  'catalog.template.notify-assignee-on-new-lead.name': 'התראה לאחראי על ליד חדש',
  'catalog.template.notify-assignee-on-new-lead.description':
    'כשנוצר ליד עם אחראי, האחראי מקבל התראה במערכת עם קישור לליד.',
  'catalog.template.note-when-lead-won.name': 'הערה כשליד נסגר בהצלחה',
  'catalog.template.note-when-lead-won.description':
    'כשליד עובר לשלב "נסגר בהצלחה", נרשמת עליו הערה ומתווספת לו תגית.',
  'catalog.template.welcome-new-lead-with-n8n.name': 'העברת לידים חדשים ל-n8n',
  'catalog.template.welcome-new-lead-with-n8n.description':
    'כל ליד חדש נשלח לתהליך ב-n8n. דורש חיבור פעיל ל-n8n.',
  'catalog.template.inbound-webhook-alert-admins.name': 'התראה למנהלים מ-webhook נכנס',
  'catalog.template.inbound-webhook-alert-admins.description':
    'מחברים webhook נכנס לתהליך, וכל המנהלים מקבלים התראה עם ההודעה שהתקבלה.',
  'catalog.template.weekday-agent-digest.name': 'סיכום בוקר של סוכן בימי חול',
  'catalog.template.weekday-agent-digest.description':
    'בכל יום חול ב-08:00, לפי אזור הזמן של הארגון, סוכן רץ והבעלים מקבל התראה עם התשובה שלו.',
  'catalog.template.agent-triage-customer-message.name': 'מיון הודעות לקוחות בעזרת AI',
  'catalog.template.agent-triage-customer-message.description':
    'כשמגיעה הודעה מלקוח, סוכן מנסח הצעת תשובה והאחראי מקבל התראה.',
  'catalog.requirement.agent': 'סוכן',
  'catalog.requirement.owner': 'בעלים',
  'catalog.requirement.n8n': 'חיבור פעיל ל-n8n',
  'catalog.requirement.inboundWebhook': 'Webhook נכנס',
  'catalog.integration.rest.name': 'REST / Webhook',
  'catalog.integration.rest.description':
    'קריאה לכל API או webhook בכתובת HTTPS מתוך האוטומציות, עם אימות לפי הצורך.',
  'catalog.integration.n8n.name': 'n8n',
  'catalog.integration.n8n.description':
    'העברת אירועים לתהליכים ב-n8n. לא חובה: שאר המערכת עובדת גם בלעדיו.',
  'catalog.integration.email.name': 'אימייל',
  'catalog.integration.email.description': 'שליחת אימייל ללקוחות מתוך אוטומציות.',
  'catalog.integration.whatsapp.name': 'WhatsApp Business',
  'catalog.integration.whatsapp.description': 'שליחה וקבלה של הודעות WhatsApp מול לקוחות.',
  'catalog.integration.crm.name': 'CRM חיצוני',
  'catalog.integration.crm.description':
    'סנכרון אנשי קשר ועסקאות עם HubSpot, Pipedrive או Salesforce.',
} as const;
