# מדריך: חיבור HilaTech AI Assistant ל-AWS (בעברית)

זה סיכום מעשי של המדריך המלא באנגלית (`aws-setup-guide.md`). הפקודות זהות, וההסברים כאן מקוצרים.
כשצריך פרט שלא מופיע כאן, ראה את הגרסה האנגלית, אותו מספר שלב.

> **חשוב לדעת: שום שלב כאן לא הורץ מול חשבון AWS אמיתי.** אין לי אישורי AWS. תשתית ה-CDK עוברת `cdk synth` ובדיקות תבנית,
> והמתאם ל-Bedrock נבדק מול mock בלבד. מזהי המודלים בקוד הם משוערים ולא מאומתים.
> צפה לתקלות קטנות, ואם מצאת הוראה שגויה, תקן אותה בקובץ.

## סימונים

- **[חינם]** אין חיוב צפוי.
- **[עלות קטנה]** סנטים עד כמה דולרים אם מנקים באותו יום.
- **[עולה כסף]** החיוב רץ לפי שעה עד שמוחקים (NAT, RDS, ALB, Redis, Fargate). שלב 23 הוא הניקוי.

## הסדר

א. אבטחת חשבון (שלבים 1 עד 4) ← ב. כלים מקומיים (5 עד 6) ← ג. אזור ו-Bedrock (7 עד 8) ← ד. פיתוח מקומי מול Bedrock (9 עד 10)
← ה. פריסת סביבת dev ל-AWS (11 עד 19) ← ו. פריסה אוטומטית מ-GitHub (20, אופציונלי) ← ז. תפעול וניקוי (21 עד 23).

**אפשר לעצור אחרי שלב 10.** אז יש לך מערכת מקומית עובדת עם Bedrock, והעלות היא טוקנים בלבד.
זמן משוער: שלבים 1 עד 10 כשעה עד שעתיים. שלבים 11 עד 19 עוד 2 עד 3 שעות בפעם הראשונה.

---

## א. פתיחה ואבטחה של החשבון (לפני שיוצרים שום משאב)

**שלב 1: פתיחת חשבון [חינם].** ב-https://aws.amazon.com צור חשבון עם מייל קבוע של החברה (לא אישי), שם `hilatech`, כרטיס אשראי
ומסלול Basic support. חשבון יכול להיות פעיל תוך דקות ועד יום.

**שלב 2: נעילת משתמש ה-root [חינם].** ב-Security credentials הפעל MFA (עדיף passkey או מפתח אבטחה, ורצוי שני התקנים).
אל תיצור מפתחות גישה ל-root. מכאן והלאה אל תעבוד עם root. אובדן ה-MFA בלי התקן שני מחייב תהליך שחזור מול התמיכה של AWS.

**שלב 3: התראות תקציב קודם לכל דבר [חינם].**

1. Billing and Cost Management ← Budgets ← Create budget ← Monthly cost budget, סכום לפי הסבולת שלך, ומייל להתראות.
2. ב-Account settings הפעל "IAM user and role access to Billing information", אחרת משתמש האדמין לא יראה חיוב.
3. הוסף Cost Anomaly Detection (חינם).

תקציב הוא **התראה ולא מגבלה**, והנתונים מתעכבים בכמה שעות. הוא לא יעצור משאב שיצא משליטה.

**שלב 4: IAM Identity Center ומשתמש אדמין [חינם].** בלי משתמשי IAM ובלי מפתחות ארוכי טווח.

1. בחר את האזור הראשי שלך (קשה לשנות אחר כך) והפעל IAM Identity Center.
2. הפעל MFA בכל כניסה, וצור משתמש עם המייל שלך.
3. צור Permission set מסוג `AdministratorAccess` והקצה אותו למשתמש ולחשבון.
4. שמור את כתובת פורטל הגישה, למשל `https://d-xxxxxxxxxx.awsapps.com/start`.

## ב. כלים מקומיים

**שלב 5: התקנה [חינם].** נדרשים Node 22+, pnpm 10+, Docker, git, `jq` ו-AWS CLI v2.

```bash
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install --update
aws --version        # צפוי: aws-cli/2.x
```

ב-macOS: `brew install awscli`. אם יש גרסה 1 ישנה קודם ב-PATH, בדוק עם `which -a aws`.

**שלב 6: התחברות מה-CLI דרך SSO [חינם].**

```bash
aws configure sso
# SSO session name: hilatech
# SSO start URL:    <כתובת הפורטל משלב 4>
# SSO region:       <אזור Identity Center>
# Profile name:     hilatech-dev
aws sso login --profile hilatech-dev
export AWS_PROFILE=hilatech-dev
aws sts get-caller-identity     # צפוי: Account ו-Arn עם AWSReservedSSO_AdministratorAccess
```

ההתחברות פגה אחרי שעות. כשמופיעה שגיאת session expired, הרץ שוב `aws sso login --profile hilatech-dev`.

## ג. אזור ו-Bedrock

**שלב 7: בחירת אזור [חינם].** בחר אזור אחד ל-dev. השיקולים לפי הסדר: זמינות המודלים שאתה רוצה, דרישות פרטיות ומיקום נתונים
(לקוחות באירופה ← אזור אירופי), השהיה, ומחיר. ברירות מחדל סבירות: `us-east-1` (הכי הרבה מודלים) או `eu-central-1` (קרוב לישראל).
**לא הצלחתי לאמת איזה מודל זמין באיזה אזור.** בדוק בחשבון שלך:

```bash
export AWS_REGION=<האזור שבחרת>
aws bedrock list-foundation-models --region $AWS_REGION \
  --query 'modelSummaries[].{id:modelId,provider:providerName}' --output table
aws bedrock list-inference-profiles --region $AWS_REGION \
  --query 'inferenceProfileSummaries[].inferenceProfileId' --output text | tr '\t' '\n' | sort
```

רשום מזהה של מודל צ'אט זול, מזהה של Claude אם אתה רוצה, ואת `amazon.titan-embed-text-v2:0` ל-embeddings.
**השתמש במזהים בדיוק כפי שהודפסו אצלך**, לא במזהים שברשימה של הקוד, שאינם מאומתים.

**שלב 8: גישה למודלים [עלות קטנה, משלמים לפי טוקן].** ברוב האזורים רוב המודלים נפתחים בשימוש הראשון.
מודלים של Anthropic (Claude) דורשים טופס חד-פעמי: Bedrock ← Model catalog ← מודל של Anthropic ← מילוי פרטי השימוש. אחר כך:

```bash
aws bedrock get-foundation-model-availability --model-id <MODEL_ID> --region $AWS_REGION \
  --query 'agreementAvailability.status' --output text      # AVAILABLE | PENDING | NOT_AVAILABLE

aws bedrock-runtime converse --region $AWS_REGION --model-id <CHAT_MODEL_OR_PROFILE_ID> \
  --messages '[{"role":"user","content":[{"text":"Say hello in five words."}]}]' \
  --inference-config '{"maxTokens":50}' --query 'output.message.content[0].text' --output text

aws bedrock-runtime invoke-model --region $AWS_REGION --model-id amazon.titan-embed-text-v2:0 \
  --content-type application/json --cli-binary-format raw-in-base64-out \
  --body '{"inputText":"hello","dimensions":1024,"normalize":true}' /tmp/titan.json
jq '{dims: (.embedding|length)}' /tmp/titan.json     # צפוי: dims 1024
```

תקלות נפוצות:

- `AccessDeniedException ... PENDING`: הטופס של Anthropic עדיין בטיפול. חכה ובדוק שוב (עד כרבע שעה).
- `on-demand throughput isn't supported`: המודל דורש מזהה **inference profile** (עם קידומת `global.`, `us.` או `eu.`). קח מזהה מהפלט של `list-inference-profiles`.
- `ThrottlingException` בחשבון חדש: מכסות ברירת מחדל נמוכות. בדוק ב-Service Quotas.

## ד. פיתוח מקומי מול Bedrock (בלי משאבים ב-AWS)

המתאם ל-Bedrock **לא משתמש במפתח API**. הוא משתמש בשרשרת האישורים הרגילה של ה-SDK, ולכן מקומית הוא משתמש בפרופיל ה-SSO שלך.

**שלב 9: הגדרת האפליקציה [עלות קטנה].**

1. הרם את הסביבה המקומית לפי `docs/development/setup.md`. המסד חייב את המיגרציה `20261110090000_bedrock_provider`; `pnpm db:migrate:dev` מחיל אותה.
2. ב-`.env` המקומי הוסף:

```bash
AI_BEDROCK_ENABLED=true
AWS_PROFILE=hilatech-dev
AWS_REGION=<האזור משלב 7>
```

3. התחבר והפעל:

```bash
aws sso login --profile hilatech-dev
pnpm dev
```

האישורים נפתרים רק בקריאה הראשונה ל-Bedrock, ולכן session שפג יתגלה אז ולא בעליית השרת.

**שלב 10: הוספת ספק Bedrock בממשק [עלות קטנה].**

1. פתח http://localhost:3000 והתחבר (עם נתוני ה-seed: `owner@demo.local`).
2. Settings ← AI ← Add provider ← Amazon Bedrock. שם: `Bedrock dev`. אזור: האזור שלך (או ריק לשימוש ב-`AWS_REGION`).
   אין שדה מפתח ואין שדה כתובת, וזה מכוון.
3. Default model: הקלד את המזהה **המדויק** שאימתת בשלבים 7 עד 8. Embedding model: `amazon.titan-embed-text-v2:0`. סמן ברירת מחדל ושמור.
4. לחץ Check בשורה החדשה. צפוי: תווית healthy עם השהיה במילישניות.

הערות:

- הרשימה המוצעת בתיבה מסומנת "unverified availability" (זמינות לא מאומתת). אפשר להקליד כל טקסט.
- `AWS credentials could not be resolved`: ה-session פג או ש-`AWS_PROFILE` לא מוגדר לתהליך ה-API.
- Bedrock לא מופיע בבחירה: `AI_BEDROCK_ENABLED=true` לא נטען. הפעל מחדש את ה-API.
- בדוק צ'אט אמיתי ב-Assistant, והעלה מסמך טקסט קטן למסד ידע כדי לבדוק embeddings. וקטורי Titan הם 1,024 ממדים ומרופדים ל-1,536 באפליקציה, וזה תקין.
- בזמן בדיקות הגדר `maxTokens` נמוך, כדי שהעלות תישאר קטנה.

**אם הגעת עד כאן והכל עובד, יש לך מערכת עובדת עם Bedrock בעלות של טוקנים בלבד.**

## ה. פריסת סביבת dev ל-AWS [עולה כסף מ-שלב 13]

כל מה שלהלן משתמש ב-`infra/cdk`. שום דבר לא נפרס אלא אם אתה מריץ `cdk deploy` בעצמך.

```bash
cd infra/cdk
npm ci
export AWS_PROFILE=hilatech-dev AWS_REGION=<האזור>
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ENV=dev
export DOMAIN=<app-dev.your-domain.com>     # הכתובת הציבורית שתצביע על ה-ALB
export ALARM_EMAIL=<you@your-domain.com>
```

**שלב 11: דומיין ותעודת TLS [חינם].** ה-API מגדיר עוגיות `Secure` בפרודקשן, ולכן **התחברות עובדת רק על HTTPS**. תעודה נדרשת.

1. Certificate Manager (ACM) באותו אזור של הפריסה ← Request ← תעודה ציבורית ל-`$DOMAIN` ← אימות DNS.
2. צור אצל ספק ה-DNS את רשומת ה-CNAME שמוצגת, וחכה למצב Issued.
3. שמור את ה-ARN:

```bash
export CERT_ARN=$(aws acm list-certificates --region $AWS_REGION \
  --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn | [0]" --output text)
```

אם התעודה תקועה ב-Pending validation, כנראה שם הדומיין הוכפל ברשומה (ממשקי DNS רבים מוסיפים אותו אוטומטית).

**שלב 12: Bootstrap ל-CDK [עלות קטנה], פעם אחת לכל חשבון ואזור.**

```bash
npx cdk bootstrap "aws://${ACCOUNT}/${AWS_REGION}"
npx cdk synth -c env=$ENV --quiet && echo synth-ok       # בדיקה בלי ליצור כלום
```

**שלב 13: רשת, רישום ונתונים [עולה כסף].** נוצרים VPC עם NAT אחד, מאגרי ECR, מסד PostgreSQL, Redis, דלי S3 וסודות. **מכאן המונה רץ.**

```bash
npx cdk deploy HilaTech-$ENV-Network HilaTech-$ENV-Registry HilaTech-$ENV-Data \
  -c env=$ENV -c alarmEmail="$ALARM_EMAIL"
```

סקור את טבלת שינויי ה-IAM וענה `y`. יצירת המסד אורכת 5 עד 15 דקות.
אם יש שגיאה על סוד שמתוכנן למחיקה, זה שריד מניקוי קודם (ראה שלב 23). דיפלוי שנכשל בפעם הראשונה נשאר במצב `ROLLBACK_COMPLETE` וצריך למחוק אותו לפני ניסיון חוזר.

**שלב 14: סודות [חינם].** מפתח ההצפנה של אישורי הארגונים נוצר כערך זמני שגורם לאפליקציה לסרב לעלות עד שתחליף אותו:

```bash
aws secretsmanager put-secret-value --secret-id hilatech/$ENV/credentials-encryption-key \
  --secret-string "$(openssl rand -base64 32)"
```

**גבה את הערך עכשיו** במנהל סיסמאות. אם יאבד, כל אישורי ה-AI השמורים של הארגונים (כולל בגיבויים) לא יהיו קריאים.

**שלב 15: בניית תמונות ודחיפה ל-ECR [עלות קטנה].**

```bash
cd ../..
export TAG=$(git rev-parse --short HEAD)
export REGISTRY="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$REGISTRY"

for svc in api workers; do
  docker build --platform linux/amd64 -f infrastructure/docker/${svc}.Dockerfile \
    -t "${REGISTRY}/hilatech-${ENV}/${svc}:${TAG}" . && docker push "${REGISTRY}/hilatech-${ENV}/${svc}:${TAG}"
done
docker build --platform linux/amd64 -f infrastructure/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL="https://${DOMAIN}" --build-arg NEXT_PUBLIC_APP_URL="https://${DOMAIN}" \
  -t "${REGISTRY}/hilatech-${ENV}/web:${TAG}" . && docker push "${REGISTRY}/hilatech-${ENV}/web:${TAG}"
```

**ה-Dockerfiles מעולם לא נבנו בפועל** (לא הייתה גישה ל-Docker Hub). כשל בבנייה הוא ככל הנראה תקלה בקוד ולא ב-AWS, ותצטרך לתקן.
הדומיין נצרב בתמונת ה-web, ולכן החלפת דומיין מחייבת בנייה מחדש שלה.

**שלב 16: פריסת האפליקציה במצב מושהה ומיגרציות [עולה כסף].**

```bash
cd infra/cdk
npx cdk deploy HilaTech-$ENV-App HilaTech-$ENV-Ops \
  -c env=$ENV -c imageTag=$TAG -c certificateArn="$CERT_ARN" -c domainName="$DOMAIN" \
  -c alarmEmail="$ALARM_EMAIL" -c pauseServices=true
```

אשר את המייל ש-AWS שולח לכתובת ההתראות. אחר כך הרץ את המיגרציות כמשימת Fargate חד-פעמית:

```bash
export CLUSTER=hilatech-$ENV
OUT=$(aws cloudformation describe-stacks --stack-name HilaTech-$ENV-App --query 'Stacks[0].Outputs' --output json)
get() { echo "$OUT" | jq -r ".[] | select(.OutputKey==\"$1\").OutputValue"; }
TASK_ARN=$(aws ecs run-task --cluster $CLUSTER --task-definition "$(get MigrateTaskDefinition)" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(get MigrateSubnets)],securityGroups=[$(get MigrateSecurityGroup)],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster $CLUSTER --tasks "$TASK_ARN"
aws ecs describe-tasks --cluster $CLUSTER --tasks "$TASK_ARN" --query 'tasks[0].containers[0].{exit:exitCode,reason:reason}'
aws logs tail /hilatech/$ENV/migrate --since 15m
```

צפוי: `exit: 0` ורשימת מיגרציות שהוחלו. תקלות סבירות, כולן לא נבדקו עדיין:

- `extension "vector" is not available`: ל-pgvector אין תמיכה בגרסת ה-PostgreSQL הזו. בחר גרסה חדשה יותר ב-`lib/stacks/data-stack.ts`.
- נתיב פקודת ה-migrate לא מתאים לתמונה: בדוק את התמונה והתאם את `command` ב-`lib/stacks/app-stack.ts`.
- שגיאות SSL מול המסד: צורת `sslmode=no-verify` אולי לא נתמכת בדרייבר.

**שלב 17: הפעלת השירותים [עולה כסף].** פרוס שוב בלי `pauseServices`:

```bash
npx cdk deploy HilaTech-$ENV-App -c env=$ENV -c imageTag=$TAG -c certificateArn="$CERT_ARN" \
  -c domainName="$DOMAIN" -c alarmEmail="$ALARM_EMAIL"
aws ecs wait services-stable --cluster $CLUSTER \
  --services hilatech-$ENV-api hilatech-$ENV-web hilatech-$ENV-workers
```

אם משימות מתחילות מחדש בלולאה, בדוק `aws logs tail /hilatech/$ENV/api --since 15m`. הסיבות הנפוצות: סוד שעדיין ערך זמני, תג תמונה שגוי, או משתנה סביבה חסר שסכמת ההגדרות דוחה (הלוג מציין איזה).

**שלב 18: הצבעת הדומיין על ה-ALB [חינם].**

```bash
aws cloudformation describe-stacks --stack-name HilaTech-$ENV-App \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text
```

צור אצל ספק ה-DNS רשומת CNAME מ-`$DOMAIN` לכתובת הזו. אם אתה ב-Cloudflare, התחל במצב DNS-only (ענן אפור).

**שלב 19: בדיקות עשן [עלות קטנה].**

```bash
curl -fsS https://$DOMAIN/api/v1/health
curl -fsS https://$DOMAIN/api/v1/health/ready      # מסד ו-Redis
curl -fsSI https://$DOMAIN/ | head -1
```

בדפדפן ב-`https://$DOMAIN`: הירשם, הוסף ספק Bedrock (הפעם הוא משתמש בתפקיד של המשימה ולא בפרופיל ה-SSO שלך), שלח הודעה ב-Assistant,
והעלה מסמך קטן למסד ידע וחפש בו. בדוק גם שהדשבורד ב-CloudWatch מציג תנועה ושאין התראה פעילה.

**נקודות פתוחות שיש לדעת:**

- מיילים רק נרשמים בלוג (`EMAIL_DRIVER=log`), ו-SES או SMTP לא מחוברים. קישור אימות אפשר לקחת מהלוג.
- קטלוג ההרשאות נזרע כרגע בסקריפט seed מקומי בלבד, ותמונת הפרודקשן לא מכילה אותו. אם הרשמה או תפקידים נכשלים, צריך להריץ את ה-seed פעם אחת
  (הוראות ב-`runbooks.md`, סעיף 9). לעולם אל תפעיל `SEED_DEMO=true` על סביבה משותפת.

## ו. פריסה אוטומטית מ-GitHub (אופציונלי, אחר כך)

**שלב 20.** יצירת תפקיד OIDC ל-GitHub Actions, מוגבל לריפו הזה ולסביבת `aws-dev` שדורשת אישור ידני. בלי מפתחות ארוכי טווח.
ה-workflow `deploy-aws.yml` כבוי כברירת מחדל (פועל רק עם `vars.AWS_DEPLOY_ENABLED`) ולא רץ מעולם. הפקודות המלאות בגרסה האנגלית.

## ז. תפעול וניקוי

**שלב 21: מה לעקוב אחריו [חינם].** העלות: NAT, RDS, ALB, Redis ו-Fargate רצים כל שעה. הבריאות: ההתראות בדשבורד ב-CloudWatch.

**שלב 22: פקודות לשימוש יומי.** צפייה בלוגים, חיבור למסד דרך port-forward ופריסה חוזרת. הפקודות בגרסה האנגלית, שלב 22.

**שלב 23: ניקוי מלא [עוצר את החיוב].** מוחקים את כל הסטאקים לפי הסדר ההפוך (App, Ops, Data, Registry, Network), ואחר כך:

- סודות ב-Secrets Manager נשארים 30 יום בחלון שחזור וחוסמים יצירה מחדש של אותם שמות. מחק אותם מיד בפקודה בגרסה האנגלית.
- בדוק שלא נשאר משאב עם התגית של האפליקציה (הפקודה בגרסה האנגלית). הדלי של CDK bootstrap נשאר ועולה סנטים בלבד.

---

## החלטות שמחכות לך

1. **`AI_BEDROCK_ENABLED` לכל סביבה.** הקריאות ל-Bedrock נעשות בזהות ה-AWS של השרת, כלומר **כל השימוש של כל הלקוחות מחויב בחשבון שלך**. אל תפעיל בסביבה משותפת בלי מנגנון חיוב ללקוחות.
2. אזור ומזהי מודלים (בדיקה בחשבון שלך, שלבים 7 עד 8).
3. דומיין ותעודת HTTPS.
4. גבולות תקציב אמיתיים (הערכים 100, 300 ו-1,000 דולר בקוד הם דוגמאות).
5. האם לבנות CloudFront ו-SES.
6. האם להוסיף סיבוב סודות אוטומטי.
7. איך לזרוע את קטלוג ההרשאות בסביבת AWS.
8. מעבר ל-`verify-full` עם תעודת ה-CA של RDS.

## מה לא נבדק (חשוב לקרוא)

- בקשות ותשובות מול Bedrock החי, מזהי מודלים ובעיקר זמינות לפי אזור.
- pgvector על RDS עם PostgreSQL 16 (בדיקת התיעוד לא הכריעה).
- בניית תמונות ה-Docker והרצתן ב-ECS, ובדיקות הבריאות של ה-web.
- אימות ל-ElastiCache, ושימוש בדלי S3 דרך תפקיד המשימה.
- תפקיד ה-OIDC ל-GitHub, וה-workflow של הפריסה.
- AgentCore לא נבנה: הוא מתועד כמתאם אופציונלי, ו-AgentRunner שלנו נשאר ברירת המחדל.
