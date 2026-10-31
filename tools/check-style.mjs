import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "rolldown/parseAst";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_FOLDERS = ["scripts", "tools"];
const MAX_CALL_DEPTH = 3;
const problems = [];

// 将 file 中的问题和一行代码的位置记录下来，最后统一输出
function report(file, source, position, message) {
    const before = source.slice(0, position);
    const line = before.split("\n").length;
    problems.push(file + ":" + line + " " + message);
}

// 遍历语法树，callback 接收当前节点及其父节点
function walk(node, parent, callback) {
    if (!node || typeof node !== "object") {
        return;
    }
    if (typeof node.type === "string") {
        callback(node, parent);
    }
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) {
                walk(child, node, callback);
            }
        } else if (value && typeof value === "object") {
            walk(value, node, callback);
        }
    }
}

// 查找函数所在行上方的中文说明，空行不会影响检查
function hasFunctionComment(source, position) {
    const before = source.slice(0, position);
    const lines = before.split("\n");
    for (let index = lines.length - 2; index >= 0; index = index - 1) {
        const line = lines[index].trim();
        if (!line) {
            continue;
        }
        const isComment = line.startsWith("//") || line.startsWith("/*") || line.startsWith("*");
        return isComment && /[\u3400-\u9fff]/.test(line);
    }
    return false;
}

// 统计连续方法调用层数，只检查直接连接的调用
function callDepth(node) {
    let depth = 1;
    let current = node;
    while (current.callee && current.callee.type === "MemberExpression") {
        const owner = current.callee.object;
        if (owner.type !== "CallExpression") {
            break;
        }
        depth = depth + 1;
        current = owner;
    }
    return depth;
}

// 用语法树检查文件，字符串中的问号、网址和注释不会被误判
function checkJavaScript(file) {
    const absolute = path.join(PROJECT_ROOT, file);
    const source = fs.readFileSync(absolute, "utf8");
    let program;
    try {
        program = parseAst(source);
    } catch (error) {
        problems.push(file + " 无法解析：" + error.message);
        return;
    }
    // 每条语法限制只检查对应节点，避免文本搜索产生误报
    walk(program, null, function inspectNode(node) {
        let message = "";
        if (node.type === "ArrowFunctionExpression") {
            message = "请使用具名普通函数";
        } else if (node.type === "ConditionalExpression") {
            message = "请用 if / else 替代三目表达式";
        } else if (node.type === "ChainExpression") {
            message = "请明确判断对象是否存在，不使用可选链";
        } else if (node.type === "SpreadElement" || node.type === "RestElement") {
            message = "请使用普通参数或循环，不使用展开与剩余语法";
        } else if (node.type === "ObjectPattern" || node.type === "ArrayPattern") {
            message = "请逐个读取属性，不使用解构";
        } else if (node.type === "UpdateExpression") {
            message = "请写出完整赋值，不使用自增自减";
        } else if (node.type === "AssignmentExpression" && node.operator !== "=") {
            message = "请写出完整赋值，不使用复合赋值";
        } else if (node.type === "LogicalExpression" && node.operator === "??") {
            message = "请用普通条件判断，不使用空值合并";
        } else if (node.type === "Property" && (node.shorthand || node.method)) {
            message = "请完整写出属性名和值，函数使用具名声明";
        } else if (node.type === "TemplateLiteral") {
            message = "请用中间变量和普通字符串连接表达内容";
        } else if (node.type === "CallExpression" && callDepth(node) > MAX_CALL_DEPTH) {
            message = "连续调用过长，请保存中间结果";
        }
        if (message) {
            report(file, source, node.start, message);
        }
        if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
            if (!node.id) {
                report(file, source, node.start, "函数必须有明确名称");
            }
            if (!hasFunctionComment(source, node.start)) {
                let name = "未命名函数";
                if (node.id) {
                    name = node.id.name;
                }
                report(file, source, node.start, name + " 缺少上方中文用途说明");
            }
        }
    });
}

// 收集指定目录中的源码文件，子目录使用相同检查规则
function collectFiles(folder, files) {
    const absolute = path.join(PROJECT_ROOT, folder);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            collectFiles(file, files);
        } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs") || entry.name.endsWith(".cjs")) {
            files.push(file);
        }
    }
}

// 检查所有自维护脚本并输出结果，依赖和构建产物不属于源码检查范围
function main() {
    const files = ["vite.config.js"];
    for (const folder of SOURCE_FOLDERS) {
        collectFiles(folder, files);
    }
    for (const file of files) {
        checkJavaScript(file);
    }
    for (const problem of problems) {
        console.error(problem);
    }
    if (problems.length > 0) {
        console.error("风格检查未通过，共 " + problems.length + " 项");
        process.exitCode = 1;
        return;
    }
    console.log("风格检查通过：" + files.length + " 个脚本");
}

main();
