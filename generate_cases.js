const fs = require('fs');

const filePath = 'd:\\Final\\final\\src\\services\\vector\\knowledgeBase.js';
let content = fs.readFileSync(filePath, 'utf-8');

function escapeString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function formatCase(c) {
  return `      {
        original: '${escapeString(c.original)}',
        optimized: '${escapeString(c.optimized)}',
        explanation: '${escapeString(c.explanation)}',
        language: '${c.language}',
        issueType: '${c.issueType}'
      }`;
}

const cases = [
  // ===== Batch 9: More comprehensive cases (150 cases) =====
  {
    original: 'const users = [{ name: "Alice", age: 25 }, { name: "Bob", age: 30 }]; const names = users.map(u => u.name);',
    optimized: 'const names = [{ name: "Alice", age: 25 }, { name: "Bob", age: 30 }].map(({ name }) => name);',
    explanation: '使用解构在map中提取属性',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'function getUser(id) { return db.query("SELECT * FROM users WHERE id = " + id); }',
    optimized: 'async function getUser(id) { const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]); return rows[0] || null; }',
    explanation: '参数化查询+async/await防止SQL注入',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const express = require("express"); const app = express();',
    optimized: 'import express from "express"; const app = express();',
    explanation: '使用ES模块替代CommonJS',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'function isValidEmail(email) { const re = /^[^@]+@[^@]+\\.[^@]+$/; return re.test(email); }',
    optimized: 'const isValidEmail = (email) => /^[^@]+@[^@]+\\.[^@]+$/.test(email);',
    explanation: '简化为箭头函数内联正则',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const data = await axios.get("https://api.example.com/users");',
    optimized: 'const { data } = await axios.get("https://api.example.com/users", { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 });',
    explanation: 'axios请求添加认证头和超时',
    language: 'javascript',
    issueType: 'reliability'
  },
  {
    original: 'const { data } = useQuery("users", fetchUsers);',
    optimized: 'const { data, isLoading, error } = useQuery({ queryKey: ["users"], queryFn: fetchUsers, staleTime: 60000 });',
    explanation: 'React Query配置queryKey和staleTime',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const [users, setUsers] = useState([]); useEffect(() => { fetchUsers().then(setUsers); }, []);',
    optimized: 'const { data: users = [] } = useSWR("users", fetchUsers, { revalidateOnFocus: false, dedupingInterval: 60000 });',
    explanation: 'SWR配置去重和聚焦重新验证',
    language: 'javascript',
    issueType: 'performance_optimization'
  },
  {
    original: 'const obj = { a: 1, b: 2, c: 3 }; const { a, ...rest } = obj;',
    optimized: 'const { a, ...rest } = { a: 1, b: 2, c: 3 };',
    explanation: '使用rest运算符排除对象属性',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const arr = [1, 2, 3, 4, 5]; const evens = arr.filter(n => n % 2 === 0); const double = evens.map(n => n * 2);',
    optimized: 'const doubleEvens = [1, 2, 3, 4, 5].filter(n => n % 2 === 0).map(n => n * 2);',
    explanation: '链式调用filter+map',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const total = [1, 2, 3, 4, 5].reduce((sum, n) => sum + n, 0);',
    optimized: 'const total = [1, 2, 3, 4, 5].reduce((sum, n) => sum + n, 0);',
    explanation: '使用reduce计算数组总和',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const max = Math.max(1, 5, 3, 9, 2);',
    optimized: 'const max = Math.max(...[1, 5, 3, 9, 2]);',
    explanation: '使用展开运算符传递数组给Math.max',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const min = Math.min(4, 2, 8, 1, 9);',
    optimized: 'const min = Math.min(...[4, 2, 8, 1, 9]);',
    explanation: '使用展开运算符传递数组给Math.min',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const arr = [1, 2, 3]; const copy = arr.slice();',
    optimized: 'const copy = [...[1, 2, 3]];',
    explanation: '使用展开运算符替代slice创建副本',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const a = [1, 2]; const b = [3, 4]; const c = a.concat(b);',
    optimized: 'const c = [...[1, 2], ...[3, 4]];',
    explanation: '使用展开运算符合并数组',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const arr = [3, 1, 4, 1, 5, 9]; const sorted = arr.sort((a, b) => a - b);',
    optimized: 'const sorted = [...[3, 1, 4, 1, 5, 9]].sort((a, b) => a - b);',
    explanation: '排序前使用展开避免修改原数组',
    language: 'javascript',
    issueType: 'bug_fix'
  },
  {
    original: 'const unique = new Set([1, 2, 2, 3, 3, 3]); const arr = Array.from(unique);',
    optimized: 'const unique = [...new Set([1, 2, 2, 3, 3, 3])];',
    explanation: 'Set去重后使用展开转回数组',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const items = [{ id: 1 }, { id: 2 }, { id: 1 }]; const unique = items.filter((item, i, arr) => arr.findIndex(t => t.id === item.id) === i);',
    optimized: 'const unique = [...new Map(items.map(item => [item.id, item])).values()];',
    explanation: '使用Map根据对象属性去重',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const promise = fetch(url).then(res => res.json()).catch(err => console.error(err));',
    optimized: 'const data = await fetch(url).then(r => r.json()).catch(err => null);',
    explanation: '使用async/await简化Promise链',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'function UserController { this.users = []; this.addUser = function(user) { this.users.push(user); }; this.getUser = function(id) { return this.users.find(u => u.id === id); }; }',
    optimized: 'class UserController { constructor() { this.users = []; } addUser(user) { this.users.push(user); } getUser(id) { return this.users.find(u => u.id === id); } }',
    explanation: '使用ES6类替代构造函数模式',
    language: 'javascript',
    issueType: 'code_architecture'
  },
  {
    original: 'const config = require("./config.json");',
    optimized: 'import config from "./config.json" with { type: "json" };',
    explanation: 'Node.js实验性JSON模块导入',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const { createServer } = require("http"); const server = createServer(app); server.listen(3000);',
    optimized: 'import { createServer } from "http"; const PORT = process.env.PORT || 3000; const server = createServer(app); server.listen(PORT);',
    explanation: '使用ES模块和环境变量端口',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const express = require("express"); const cors = require("cors"); const helmet = require("helmet"); const morgan = require("morgan");',
    optimized: 'import express from "express"; import cors from "cors"; import helmet from "helmet"; import morgan from "morgan";',
    explanation: 'ES模块导入Express中间件',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'function validateRequest(req, res, next) { const { body } = req; if (!body.name) { return res.status(400).json({ error: "Name is required" }); } next(); }',
    optimized: 'const validateRequest = (req, res, next) => { const { name } = req.body; if (!name) return res.status(400).json({ error: "Name is required" }); next(); };',
    explanation: 'Express中间件简化为箭头函数',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const db = require("./db"); const userController = require("./userController");',
    optimized: 'import db from "./db.js"; import * as userController from "./userController.js";',
    explanation: 'ES模块导入本地文件',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'async function main() { const client = await redis.connect(); const value = await client.get("key"); console.log(value); } main().catch(console.error);',
    optimized: 'const redisClient = redis.createClient({ url: process.env.REDIS_URL }); redisClient.on("error", (err) => console.error("Redis Error:", err)); await redisClient.connect(); const value = await redisClient.get("key");',
    explanation: 'Redis客户端事件监听和连接管理',
    language: 'javascript',
    issueType: 'reliability'
  },
  {
    original: 'const { MongoClient } = require("mongodb"); const client = new MongoClient("mongodb://localhost:27017"); client.connect();',
    optimized: 'import { MongoClient } from "mongodb"; const client = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 10 }); await client.connect(); process.on("SIGTERM", () => client.close());',
    explanation: 'MongoDB连接池和优雅关闭',
    language: 'javascript',
    issueType: 'resource_management'
  },
  {
    original: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();',
    optimized: 'import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["error"] });',
    explanation: 'PrismaClient配置开发环境日志',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Server } = require("socket.io"); const io = new Server(3000);',
    optimized: 'import { Server } from "socket.io"; const io = new Server({ cors: { origin: process.env.CLIENT_URL, methods: ["GET", "POST"] } }); io.listen(parseInt(process.env.PORT) || 3000);',
    explanation: 'Socket.IO配置CORS和端口',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { v4: uuidv4 } = require("uuid"); const id = uuidv4();',
    optimized: 'import { randomUUID } from "crypto"; const id = randomUUID();',
    explanation: '使用Node.js内置crypto.randomUUID',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const bcrypt = require("bcrypt"); const hash = bcrypt.hashSync(password, 10); const valid = bcrypt.compareSync(inputPassword, hash);',
    optimized: 'import bcrypt from "bcrypt"; const hash = await bcrypt.hash(password, 12); const valid = await bcrypt.compare(inputPassword, hash);',
    explanation: '使用异步bcrypt和更高的work factor',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const jwt = require("jsonwebtoken"); const token = jwt.sign({ userId }, "secret"); const decoded = jwt.verify(token, "secret");',
    optimized: 'import jwt from "jsonwebtoken"; const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "15m" }); const decoded = jwt.verify(token, process.env.JWT_SECRET);',
    explanation: 'JWT使用环境变量密钥和过期时间',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const rateLimit = require("express-rate-limit"); app.use(rateLimit({ windowMs: 60000, max: 100 }));',
    optimized: 'import rateLimit from "express-rate-limit"; app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.RATE_LIMIT || 100, standardHeaders: true, legacyHeaders: false }));',
    explanation: '速率限制使用环境变量配置',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const helmet = require("helmet"); app.use(helmet());',
    optimized: 'import helmet from "helmet"; app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["self"], scriptSrc: ["self", "unsafe-inline"] } } }));',
    explanation: 'Helmet配置自定义CSP策略',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const csrf = require("csurf"); app.use(csrf({ cookie: true }));',
    optimized: 'import csrf from("csurf"); app.use(csrf({ cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" } }));',
    explanation: 'CSRF Cookie安全配置',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const session = require("express-session"); app.use(session({ secret: "secret" }));',
    optimized: 'import session from "express-session"; import connectRedis from "connect-redis"; const redisClient = redis.createClient(); app.use(session({ store: new connectRedis({ client: redisClient }), secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: true, maxAge: 3600000 } }));',
    explanation: 'Session使用Redis存储和安全Cookie配置',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { Client } = require("@line/bot-sdk"); const client = new Client({ channelSecret: "secret", channelAccessToken: "token" });',
    optimized: 'import { Client } from "@line/bot-sdk"; const client = new Client({ channelSecret: process.env.LINE_CHANNEL_SECRET, channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });',
    explanation: 'LINE Bot SDK使用环境变量',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { Telegraf } = require("telegraf"); const bot = new Telegraf("token");',
    optimized: 'import { Telegraf } from "telegraf"; const bot = new Telegraf(process.env.TELEGRAM_TOKEN); bot.launch(); process.once("SIGINT", () => bot.stop("SIGINT"));',
    explanation: 'Telegram Bot使用环境变量和优雅停止',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { viber } = require("viber-bot"); const bot = new viber.Bot({ authToken: "token" });',
    optimized: 'import { Bot } from "viber-bot"; const bot = new Bot({ authToken: process.env.VIBER_TOKEN });',
    explanation: 'Viber Bot使用环境变量',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { createHash } = require("crypto"); const hash = createHash("sha256").update(password).digest("hex");',
    optimized: 'import { scryptSync, randomBytes } from "crypto"; const salt = randomBytes(16).toString("hex"); const hash = scryptSync(password, salt, 64).toString("hex");',
    explanation: '使用scrypt替代SHA256进行密码哈希',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { createCipheriv, createDecipheriv, randomBytes } = require("crypto");',
    optimized: 'import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";',
    explanation: 'ES模块导入加密函数',
    language: 'javascript',
    issueType: 'code_simplification'
  },
  {
    original: 'const algorithm = "aes-256-cbc"; const key = randomBytes(32); const iv = randomBytes(16); const cipher = createCipheriv(algorithm, key, iv);',
    optimized: 'const algorithm = "aes-256-gcm"; const key = createHash("sha256").update(process.env.ENCRYPTION_KEY).digest(); const iv = randomBytes(12); const cipher = createCipheriv(algorithm, key, iv);',
    explanation: '使用AES-256-GCM替代CBC模式',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { S3 } = require("aws-sdk"); const s3 = new S3();',
    optimized: 'import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"; const s3 = new S3Client({ region: process.env.AWS_REGION });',
    explanation: 'AWS SDK v3模块化客户端',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { DynamoDB } = require("aws-sdk"); const dynamo = new DynamoDB();',
    optimized: 'import { DynamoDBClient } from "@aws-sdk/client-dynamodb"; const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });',
    explanation: 'DynamoDB v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Lambda } = require("aws-sdk"); const lambda = new Lambda();',
    optimized: 'import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"; const lambda = new LambdaClient({ region: process.env.AWS_REGION });',
    explanation: 'Lambda v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { SQS } = require("aws-sdk"); const sqs = new SQS();',
    optimized: 'import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs"; const sqs = new SQSClient({ region: process.env.AWS_REGION });',
    explanation: 'SQS v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { SNS } = require("aws-sdk"); const sns = new SNS();',
    optimized: 'import { SNSClient, PublishCommand } from "@aws-sdk/client-sns"; const sns = new SNSClient({ region: process.env.AWS_REGION });',
    explanation: 'SNS v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Cloudwatch } = require("aws-sdk"); const cloudwatch = new Cloudwatch();',
    optimized: 'import { CloudWatchClient } from "@aws-sdk/client-cloudwatch"; const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION });',
    explanation: 'CloudWatch v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { SES } = require("aws-sdk"); const ses = new SES();',
    optimized: 'import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses"; const ses = new SESClient({ region: process.env.AWS_REGION });',
    explanation: 'SES v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { ECS } = require("aws-sdk"); const ecs = new ECS();',
    optimized: 'import { ECSClient } from "@aws-sdk/client-ecs"; const ecs = new ECSClient({ region: process.env.AWS_REGION });',
    explanation: 'ECS v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { EventBridge } = require("aws-sdk"); const events = new EventBridge();',
    optimized: 'import { EventBridgeClient } from "@aws-sdk/client-eventbridge"; const events = new EventBridgeClient({ region: process.env.AWS_REGION });',
    explanation: 'EventBridge v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { ApiGatewayManagementApi } = require("aws-sdk"); const apiGw = new ApiGatewayManagementApi();',
    optimized: 'import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi"; const apiGw = new ApiGatewayManagementApiClient({ endpoint: process.env.API_GW_ENDPOINT });',
    explanation: 'API Gateway管理API v3配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { IAM } = require("aws-sdk"); const iam = new IAM();',
    optimized: 'import { IAMClient } from "@aws-sdk/client-iam"; const iam = new IAMClient();',
    explanation: 'IAM v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { STS } = require("aws-sdk"); const sts = new STS();',
    optimized: 'import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts"; const sts = new STSClient();',
    explanation: 'STS v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { SecretsManager } = require("aws-sdk"); const secrets = new SecretsManager();',
    optimized: 'import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager"; const secrets = new SecretsManagerClient();',
    explanation: 'Secrets Manager v3配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { ParameterStore } = require("aws-sdk"); const ssm = new ParameterStore();',
    optimized: 'import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm"; const ssm = new SSMClient();',
    explanation: 'SSM Parameter Store v3配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Rekognition } = require("aws-sdk"); const rek = new Rekognition();',
    optimized: 'import { RekognitionClient, DetectLabelsCommand } from "@aws-sdk/client-rekognition"; const rek = new RekognitionClient();',
    explanation: 'Rekognition v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Translate } = require("aws-sdk"); const translate = new Translate();',
    optimized: 'import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate"; const translate = new TranslateClient();',
    explanation: 'Translate v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Polly } = require("aws-sdk"); const polly = new Polly();',
    optimized: 'import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly"; const polly = new PollyClient();',
    explanation: 'Polly TTS v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { LexRuntimeService } = require("aws-sdk"); const lex = new LexRuntimeService();',
    optimized: 'import { LexRuntimeV2Client } from "@aws-sdk/client-lex-runtime-v2"; const lex = new LexRuntimeV2Client();',
    explanation: 'Lex v2客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Bedrock } = require("@aws-sdk/client-bedrock"); const bedrock = new Bedrock();',
    optimized: 'import { BedrockClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime"; const bedrock = new BedrockClient({ region: "us-east-1" });',
    explanation: 'Bedrock v3客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'import numpy as np; arr = np.array([1, 2, 3]); print(arr.mean())',
    optimized: 'import numpy as np; arr = np.array([1, 2, 3]); print(np.mean(arr))',
    explanation: '使用np.mean函数计算平均值',
    language: 'python',
    issueType: 'code_simplification'
  },
  {
    original: 'import pandas as pd; df = pd.read_csv("data.csv"); filtered = df[df["age"] > 18];',
    optimized: 'import pandas as pd; df = pd.read_csv("data.csv"); filtered = df.query("age > 18");',
    explanation: '使用query方法简化DataFrame过滤',
    language: 'python',
    issueType: 'code_simplification'
  },
  {
    original: 'import pandas as pd; df = pd.read_csv("data.csv"); result = df.groupby("category")["value"].sum();',
    optimized: 'import pandas as pd; df = pd.read_csv("data.csv"); result = df.groupby("category")["value"].agg(["sum", "mean", "count"]);',
    explanation: '使用agg一次计算多个聚合函数',
    language: 'python',
    issueType: 'code_simplification'
  },
  {
    original: 'import pandas as pd; df = pd.read_csv("data.csv"); df["name"] = df["name"].str.upper();',
    optimized: 'import pandas as pd; df = pd.read_csv("data.csv"); df["name"] = df["name"].str.upper().str.strip();',
    explanation: '链式字符串方法处理',
    language: 'python',
    issueType: 'code_simplification'
  },
  {
    original: 'import sqlalchemy; engine = sqlalchemy.create_engine("sqlite:///db.sqlite")',
    optimized: 'from sqlalchemy import create_engine, text; engine = create_engine("sqlite:///db.sqlite", echo=True) with engine.connect() as conn: result = conn.execute(text("SELECT * FROM users"))',
    explanation: 'SQLAlchemy 2.0使用text()和Connection',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'from django.shortcuts import render; from .models import User; def index(request): users = User.objects.all(); return render(request, "index.html", {"users": users});',
    optimized: 'from django.shortcuts import render; from django.db.models import Count; from .models import User; def index(request): users = User.objects.annotate(post_count=Count("posts")).order_by("-post_count"); return render(request, "index.html", {"users": users});',
    explanation: 'Django ORM使用annotate和order_by优化查询',
    language: 'python',
    issueType: 'performance_optimization'
  },
  {
    original: 'from rest_framework import serializers; class UserSerializer(serializers.Serializer): name = serializers.CharField(); age = serializers.IntegerField();',
    optimized: 'from rest_framework import serializers; from .models import User; class UserSerializer(serializers.ModelSerializer): class Meta: model = User; fields = "__all__";',
    explanation: 'DRF使用ModelSerializer替代Serializer',
    language: 'python',
    issueType: 'code_simplification'
  },
  {
    original: 'import tensorflow as tf; model = tf.keras.Sequential([tf.keras.layers.Dense(64), tf.keras.layers.Dense(1)])',
    optimized: 'import tensorflow as tf; model = tf.keras.Sequential([tf.keras.layers.Dense(64, activation="relu"), tf.keras.layers.Dropout(0.2), tf.keras.layers.Dense(1)])',
    explanation: '添加激活函数和Dropout防止过拟合',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import torch; model = torch.nn.Sequential(torch.nn.Linear(10, 64), torch.nn.Linear(64, 1))',
    optimized: 'import torch; model = torch.nn.Sequential(torch.nn.Linear(10, 64), torch.nn.ReLU(), torch.nn.Dropout(0.2), torch.nn.Linear(64, 1))',
    explanation: 'PyTorch添加激活函数和正则化',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import requests; response = requests.get("https://api.example.com/data"); data = response.json();',
    optimized: 'import requests; response = requests.get("https://api.example.com/data", headers={"Authorization": f"Bearer {token}"}, timeout=5); response.raise_for_status(); data = response.json();',
    explanation: 'requests添加认证头、超时和状态检查',
    language: 'python',
    issueType: 'reliability'
  },
  {
    original: 'import httpx; response = httpx.get("https://api.example.com/data");',
    optimized: 'import httpx; async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client: response = await client.get("https://api.example.com/data", headers={"Authorization": f"Bearer {token}"})',
    explanation: 'httpx异步客户端配置超时和认证',
    language: 'python',
    issueType: 'performance_optimization'
  },
  {
    original: 'import aiohttp; async with aiohttp.ClientSession() as session: async with session.get("https://api.example.com/data") as resp: data = await resp.json()',
    optimized: 'import aiohttp; async with aiohttp.ClientSession(headers={"Authorization": f"Bearer {token}"}) as session: async with session.get("https://api.example.com/data", timeout=aiohttp.ClientTimeout(total=5)) as resp: data = await resp.json()',
    explanation: 'aiohttp添加认证头和超时配置',
    language: 'python',
    issueType: 'reliability'
  },
  {
    original: 'import redis; r = redis.Redis(); r.set("key", "value"); value = r.get("key");',
    optimized: 'import redis; r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0")); r.set("key", "value", ex=3600); value = r.get("key");',
    explanation: 'Redis使用环境URL和过期时间',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import celery; app = celery.Celery("tasks"); app.config_from_object("celeryconfig");',
    optimized: 'import celery; app = celery.Celery("tasks", broker=os.environ["CELERY_BROKER_URL"], backend=os.environ["CELERY_RESULT_BACKEND"]); app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json", timezone="UTC");',
    explanation: 'Celery使用环境变量配置和JSON序列化',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'from apscheduler.schedulers.background import BackgroundScheduler; scheduler = BackgroundScheduler(); scheduler.start();',
    optimized: 'from apscheduler.schedulers.asyncio import AsyncIOScheduler; scheduler = AsyncIOScheduler(timezone="UTC"); scheduler.add_job(sync_data, "cron", hour=0, minute=0);',
    explanation: 'APScheduler使用异步调度器和UTC时区',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'from celery import Celery; app = Celery("tasks", broker="redis://localhost:6379");',
    optimized: 'from celery import Celery; app = Celery("tasks", broker=os.environ["CELERY_BROKER"], backend=os.environ["CELERY_BACKEND"]); app.conf.update(broker_connection_retry_on_startup=True);',
    explanation: 'Celery配置重试和环境变量',
    language: 'python',
    issueType: 'reliability'
  },
  {
    original: 'import boto3; s3 = boto3.client("s3"); s3.upload_file("file.txt", "bucket", "key");',
    optimized: 'import boto3; s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1")); s3.upload_file("file.txt", "bucket", "key", ExtraArgs={"ContentType": "text/plain", "ServerSideEncryption": "AES256"});',
    explanation: 'Boto3 S3上传添加Content-Type和SSE',
    language: 'python',
    issueType: 'security'
  },
  {
    original: 'import boto3; dynamodb = boto3.resource("dynamodb"); table = dynamodb.Table("users");',
    optimized: 'import boto3; dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1")); table = dynamodb.Table(os.environ.get("DYNAMODB_TABLE", "users"));',
    explanation: 'DynamoDB使用环境变量配置表名',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; lambda_client = boto3.client("lambda"); response = lambda_client.invoke(FunctionName="my-function");',
    optimized: 'import boto3; lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION")); response = lambda_client.invoke(FunctionName=os.environ["FUNCTION_NAME"], InvocationType="RequestResponse");',
    explanation: 'Lambda调用使用环境变量和调用类型',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; sns = boto3.client("sns"); sns.publish(TopicArn="arn:aws:sns:us-east-1:123456789:test", Message="Hello");',
    optimized: 'import boto3; sns = boto3.client("sns", region_name=os.environ.get("AWS_REGION")); sns.publish(TopicArn=os.environ["SNS_TOPIC_ARN"], Message="Hello", Subject="Test");',
    explanation: 'SNS发布使用环境变量配置',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; sqs = boto3.client("sqs"); sqs.send_message(QueueUrl="https://sqs.amazonaws.com/123/test", MessageBody="Hello");',
    optimized: 'import boto3; sqs = boto3.client("sqs", region_name=os.environ.get("AWS_REGION")); sqs.send_message(QueueUrl=os.environ["SQS_QUEUE_URL"], MessageBody="Hello", DelaySeconds=0);',
    explanation: 'SQS发送消息使用环境变量',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; ec2 = boto3.resource("ec2"); instances = ec2.instances.filter(Filters=[{"Name": "instance-state-name", "Values": ["running"]}]);',
    optimized: 'import boto3; ec2 = boto3.resource("ec2", region_name=os.environ.get("AWS_REGION")); instances = ec2.instances.filter(Filters=[{"Name": "instance-state-name", "Values": ["running"]}]);',
    explanation: 'EC2资源配置区域',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; iam = boto3.client("iam"); iam.create_user(UserName="newuser");',
    optimized: 'import boto3; iam = boto3.client("iam"); iam.create_user(UserName=os.environ["IAM_USER_NAME"]); iam.attach_user_policy(UserName=os.environ["IAM_USER_NAME"], PolicyArn="arn:aws:iam::aws:policy/AmazonS3FullAccess");',
    explanation: 'IAM创建用户并附加策略',
    language: 'python',
    issueType: 'security'
  },
  {
    original: 'import boto3; sts = boto3.client("sts"); response = sts.get_caller_identity();',
    optimized: 'import boto3; sts = boto3.client("sts"); response = sts.assume_role(RoleArn=os.environ["ROLE_ARN"], RoleSessionName="session");',
    explanation: 'STS AssumeRole获取临时凭据',
    language: 'python',
    issueType: 'security'
  },
  {
    original: 'import boto3; secrets = boto3.client("secretsmanager"); response = secrets.get_secret_value(SecretId="my-secret");',
    optimized: 'import boto3; secrets = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION")); response = secrets.get_secret_value(SecretId=os.environ["SECRET_ID"]);',
    explanation: 'Secrets Manager使用环境变量',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; ssm = boto3.client("ssm"); response = ssm.get_parameter(Name="/app/db/password", WithDecryption=True);',
    optimized: 'import boto3; ssm = boto3.client("ssm", region_name=os.environ.get("AWS_REGION")); response = ssm.get_parameter(Name=os.environ["SSM_PARAMETER"], WithDecryption=True);',
    explanation: 'SSM Parameter Store使用环境变量',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; comprehend = boto3.client("comprehend"); response = comprehend.detect_sentiment(Text="I love this product!", LanguageCode="en");',
    optimized: 'import boto3; comprehend = boto3.client("comprehend", region_name=os.environ.get("AWS_REGION")); response = comprehend.detect_sentiment(Text="I love this product!", LanguageCode="en");',
    explanation: 'Comprehend NLP分析配置区域',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; translate = boto3.client("translate"); response = translate.translate_text(Text="Hello", SourceLanguageCode="en", TargetLanguageCode="es");',
    optimized: 'import boto3; translate = boto3.client("translate", region_name=os.environ.get("AWS_REGION")); response = translate.translate_text(Text="Hello", SourceLanguageCode="en", TargetLanguageCode="es");',
    explanation: 'Translate配置区域',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; polly = boto3.client("polly"); response = polly.synthesize_speech(Text="Hello", OutputFormat="mp3", VoiceId="Joanna");',
    optimized: 'import boto3; polly = boto3.client("polly", region_name=os.environ.get("AWS_REGION")); response = polly.synthesize_speech(Text="Hello", OutputFormat="mp3", VoiceId="Joanna", Engine="neural");',
    explanation: 'Polly TTS配置神经引擎和区域',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; lex = boto3.client("lexv2-runtime"); response = lex.recognize_text(botId="bot-id", botAliasId="alias-id", localeId="en_US", sessionId="session-id", text="Hello");',
    optimized: 'import boto3; lex = boto3.client("lexv2-runtime", region_name=os.environ.get("AWS_REGION")); response = lex.recognize_text(botId=os.environ["LEX_BOT_ID"], botAliasId=os.environ["LEX_ALIAS_ID"], localeId="en_US", sessionId=str(uuid.uuid4()), text="Hello");',
    explanation: 'Lex v2使用环境变量和UUID会话',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'import boto3; bedrock = boto3.client("bedrock-runtime");',
    optimized: 'import boto3; bedrock = boto3.client("bedrock-runtime", region_name="us-east-1");',
    explanation: 'Bedrock Runtime配置区域',
    language: 'python',
    issueType: 'code_quality'
  },
  {
    original: 'const { Client } = require("pg"); const client = new Client({ user: "postgres", host: "localhost", database: "mydb", password: "pass" });',
    optimized: 'import { Client } from "pg"; const client = new Client({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: parseInt(process.env.DB_PORT) || 5432 });',
    explanation: 'PostgreSQL客户端使用环境变量',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { Pool } = require("pg"); const pool = new Pool({ user: "postgres", host: "localhost", database: "mydb", password: "pass", max: 20 });',
    optimized: 'import { Pool } from "pg"; const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: parseInt(process.env.DB_POOL_MAX) || 20, idleTimeoutMillis: 30000 });',
    explanation: 'PostgreSQL连接池使用DATABASE_URL',
    language: 'javascript',
    issueType: 'resource_management'
  },
  {
    original: 'const { createClient } = require("redis"); const client = createClient({ host: "localhost", port: 6379 });',
    optimized: 'import { createClient } from "redis"; const client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379/0", socket: { reconnectStrategy: 1000 } });',
    explanation: 'Redis v4连接配置URL和重连策略',
    language: 'javascript',
    issueType: 'reliability'
  },
  {
    original: 'const { InfluxDB, Point } = require("@influxdata/influxdb-client"); const influx = new InfluxDB({ url: "http://localhost:8086", token: "token" });',
    optimized: 'import { InfluxDB, Point } from "@influxdata/influxdb-client"; const influx = new InfluxDB({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN }); const writeClient = influx.getWriteApi(process.env.INFLUX_ORG, process.env.INFLUX_BUCKET);',
    explanation: 'InfluxDB 2.0使用环境变量配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Client } = require("@elastic/elasticsearch"); const client = new Client({ node: "http://localhost:9200" });',
    optimized: 'import { Client } from "@elastic/elasticsearch"; const client = new Client({ node: process.env.ELASTICSEARCH_URL, auth: { apiKey: process.env.ELASTICSEARCH_API_KEY } });',
    explanation: 'Elasticsearch配置URL和API Key认证',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { createClient } = require("@clickhouse/client"); const client = createClient({ host: "http://localhost:8123" });',
    optimized: 'import { createClient } from "@clickhouse/client"; const client = createClient({ host: process.env.CLICKHOUSE_URL, username: process.env.CLICKHOUSE_USER, password: process.env.CLICKHOUSE_PASSWORD, database: process.env.CLICKHOUSE_DB });',
    explanation: 'ClickHouse客户端使用环境变量',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { createClient } = require("@qdrant/js-client-rest"); const client = createClient({ url: "http://localhost:6333" });',
    optimized: 'import { QdrantClient } from "@qdrant/js-client-rest"; const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });',
    explanation: 'Qdrant向量数据库客户端配置',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { MilvusClient } = require("@zilliz/milvus2-sdk-node"); const client = new MilvusClient({ address: "localhost:19530" });',
    optimized: 'import { MilvusClient } from "@zilliz/milvus2-sdk-node"; const client = new MilvusClient({ address: process.env.MILVUS_ADDRESS, username: process.env.MILVUS_USER, password: process.env.MILVUS_PASSWORD });',
    explanation: 'Milvus客户端配置认证信息',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Couchbase } = require("couchbase"); const cluster = Couchbase.connect("couchbase://localhost");',
    optimized: 'import { Cluster } from "couchbase"; const cluster = await Cluster.connect(process.env.COUCHBASE_URL, { username: process.env.COUCHBASE_USER, password: process.env.COUCHBASE_PASSWORD }); const bucket = cluster.bucket(process.env.COUCHBASE_BUCKET);',
    explanation: 'Couchbase连接配置认证和Bucket',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Datastore } = require("@google-cloud/datastore"); const datastore = new Datastore();',
    optimized: 'import { Datastore } from "@google-cloud/datastore"; const datastore = new Datastore({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'GCP Datastore配置项目和密钥',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Firestore } = require("@google-cloud/firestore"); const firestore = new Firestore();',
    optimized: 'import { Firestore } from "@google-cloud/firestore"; const firestore = new Firestore({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Firestore配置项目和密钥文件',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { BigQuery } = require("@google-cloud/bigquery"); const bigquery = new BigQuery();',
    optimized: 'import { BigQuery } from "@google-cloud/bigquery"; const bigquery = new BigQuery({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'BigQuery配置项目ID和密钥',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { PubSub } = require("@google-cloud/pubsub"); const pubsub = new PubSub();',
    optimized: 'import { PubSub } from "@google-cloud/pubsub"; const pubsub = new PubSub({ projectId: process.env.GCP_PROJECT }); const topic = pubsub.topic(process.env.PUBSUB_TOPIC);',
    explanation: 'Pub/Sub配置项目ID',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Storage } = require("@google-cloud/storage"); const storage = new Storage();',
    optimized: 'import { Storage } from "@google-cloud/storage"; const storage = new Storage({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE }); const bucket = storage.bucket(process.env.GCS_BUCKET);',
    explanation: 'GCS配置项目和密钥文件',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Speech } = require("@google-cloud/speech"); const speech = new Speech();',
    optimized: 'import { SpeechClient } from "@google-cloud/speech"; const speech = new SpeechClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Speech-to-Text配置项目和密钥',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { TranslationServiceClient } = require("@google-cloud/translation"); const client = new TranslationServiceClient();',
    optimized: 'import { TranslationServiceClient } from "@google-cloud/translation"; const client = new TranslationServiceClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Cloud Translation配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { TextToSpeechClient } = require("@google-cloud/text-to-speech"); const client = new TextToSpeechClient();',
    optimized: 'import { TextToSpeechClient } from "@google-cloud/text-to-speech"; const client = new TextToSpeechClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'TTS配置项目和密钥文件',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Vision } = require("@google-cloud/vision"); const client = new Vision();',
    optimized: 'import { ImageAnnotatorClient } from "@google-cloud/vision"; const client = new ImageAnnotatorClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Vision API配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Tasks } = require("@google-cloud/tasks"); const client = new Tasks();',
    optimized: 'import { CloudTasksClient } from "@google-cloud/tasks"; const client = new CloudTasksClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Cloud Tasks配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Logging } = require("@google-cloud/logging"); const logging = new Logging();',
    optimized: 'import { Logging } from "@google-cloud/logging"; const logging = new Logging({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Cloud Logging配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Compute } = require("@google-cloud/compute"); const compute = new Compute();',
    optimized: 'import { InstancesClient } from "@google-cloud/compute"; const compute = new InstancesClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'GCE配置项目和密钥文件',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Container } = require("@google-cloud/container"); const container = new Container();',
    optimized: 'import { ClusterManagerClient } from "@google-cloud/container"; const container = new ClusterManagerClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'GKE配置项目和密钥文件',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { CloudRun } = require("@google-cloud/run"); const client = new CloudRun();',
    optimized: 'import { CloudRunClient } from "@google-cloud/run"; const client = new CloudRunClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Cloud Run配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { SecretManagerServiceClient } = require("@google-cloud/secret-manager"); const client = new SecretManagerServiceClient();',
    optimized: 'import { SecretManagerServiceClient } from "@google-cloud/secret-manager"; const client = new SecretManagerServiceClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Secret Manager配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { Dialogflow } = require("@google-cloud/dialogflow"); const sessions = new Dialogflow.SessionsClient();',
    optimized: 'import { SessionsClient } from "@google-cloud/dialogflow-cx"; const sessions = new SessionsClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Dialogflow CX配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { VideoIntelligenceServiceClient } = require("@google-cloud/video-intelligence"); const client = new VideoIntelligenceServiceClient();',
    optimized: 'import { VideoIntelligenceServiceClient } from "@google-cloud/video-intelligence"; const client = new VideoIntelligenceServiceClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Video Intelligence配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { DLP } = require("@google-cloud/dlp"); const dlp = new DLP();',
    optimized: 'import { DlpServiceClient } from "@google-cloud/dlp"; const dlp = new DlpServiceClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'DLP API配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { IAM } = require("@google-cloud/iam"); const iam = new IAM();',
    optimized: 'import { IAMClient } from "@google-cloud/iam"; const iam = new IAMClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'IAM API配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { KMS } = require("@google-cloud/kms"); const kms = new KMS();',
    optimized: 'import { KeyManagementServiceClient } from "@google-cloud/kms"; const kms = new KeyManagementServiceClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'KMS密钥管理配置项目',
    language: 'javascript',
    issueType: 'security'
  },
  {
    original: 'const { ArtifactRegistry } = require("@google-cloud/artifact-registry"); const client = new ArtifactRegistry();',
    optimized: 'import { ArtifactRegistryClient } from "@google-cloud/artifact-registry"; const client = new ArtifactRegistryClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Artifact Registry配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  },
  {
    original: 'const { CloudFunctionsServiceClient } = require("@google-cloud/functions"); const client = new CloudFunctionsServiceClient();',
    optimized: 'import { CloudFunctionsServiceClient } from "@google-cloud/functions"; const client = new CloudFunctionsServiceClient({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
    explanation: 'Cloud Functions配置项目',
    language: 'javascript',
    issueType: 'code_quality'
  }
];

const insertPoint = content.lastIndexOf('    ];');
if (insertPoint === -1) {
  console.error('Could not find insertion point');
  process.exit(1);
}

const lastBrace = content.lastIndexOf('}', insertPoint);

const newCasesStr = ',\n' + cases.map(formatCase).join(',\n');

const before = content.slice(0, lastBrace + 1);
const after = content.slice(lastBrace + 1);
const newContent = before + newCasesStr + after;

fs.writeFileSync(filePath, newContent, 'utf-8');
console.log(`Batch 9: Inserted ${cases.length} cases.`);