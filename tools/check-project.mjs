import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "rolldown/parseAst";
import postcss from "postcss";
import * as config from "../scripts/config.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_FOLDERS = ["scripts", "styles", "tools", "assets", "screenshots"];
const files = [];
const problems = [];
const references = new Set();
const moduleExports = [];
const moduleImports = new Set();

// 收集自维护文件，不进入依赖、构建结果和本地课程资料目录
function collect(folder) {
    const absolute = path.join(PROJECT_ROOT, folder);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            collect(file);
        } else {
            files.push(file);
        }
    }
}

// 将引用 address 转为本地路径，网页绝对地址优先在 public 中查找
function resolveReference(file, address) {
    const clean = address.split(/[?#]/)[0];
    if (!clean || address.startsWith("http") || address.startsWith("data:")) {
        return null;
    }
    let target;
    if (address.startsWith("/")) {
        target = path.join(PROJECT_ROOT, "public", clean.slice(1));
        if (!fs.existsSync(target)) {
            target = path.join(PROJECT_ROOT, clean.slice(1));
        }
    } else {
        target = path.resolve(PROJECT_ROOT, path.dirname(file), clean);
    }
    return target;
}

// 检查一个静态引用是否存在，并记录仍在使用的资源
function checkReference(file, address) {
    const target = resolveReference(file, address);
    if (!target) {
        return;
    }
    references.add(target);
    if (!fs.existsSync(target)) {
        problems.push(file + " 引用了不存在的文件：" + address);
    }
}

// 检查页面、样式和 README 中的本地引用，CSS 同时执行语法解析
function checkTextReferences(file) {
    const absolute = path.join(PROJECT_ROOT, file);
    const source = fs.readFileSync(absolute, "utf8");
    let pattern;
    if (file.endsWith(".html")) {
        pattern = /(?:src|href)=["']([^"']+)["']/g;
        if (/<style[\s>]|\sstyle=|\son[a-z]+=/i.test(source)) {
            problems.push(file + " 包含内联样式或事件，请放到对应样式或界面模块");
        }
    } else if (file.endsWith(".css")) {
        postcss.parse(source, { from: file });
        pattern = /url\(["']?([^"')]+)["']?\)/g;
    } else {
        pattern = /!\[[^\]]*\]\(([^)]+)\)/g;
    }
    for (const match of source.matchAll(pattern)) {
        checkReference(file, match[1]);
    }
}

// 检查模块依赖和未使用导入，导入属性名不算实际使用
function checkModule(file) {
    const absolute = path.join(PROJECT_ROOT, file);
    const source = fs.readFileSync(absolute, "utf8");
    const program = parseAst(source);
    const imported = [];
    const reads = new Set();
    // 记录模块对外接口，只有其他模块实际导入的名称才需要保留导出
    for (const statement of program.body) {
        if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
            const declaration = statement.declaration;
            if (declaration.id) {
                moduleExports.push({ file: absolute, name: declaration.id.name });
            }
            if (declaration.type === "VariableDeclaration") {
                for (const variable of declaration.declarations) {
                    moduleExports.push({ file: absolute, name: variable.id.name });
                }
            }
        }
        if (statement.type === "ImportDeclaration" && statement.source.value.startsWith(".")) {
            const target = resolveReference(file, statement.source.value);
            for (const specifier of statement.specifiers) {
                if (specifier.type === "ImportNamespaceSpecifier") {
                    moduleImports.add(target + "|*");
                } else if (specifier.type === "ImportSpecifier") {
                    moduleImports.add(target + "|" + specifier.imported.name);
                }
            }
        }
    }
    // 递归读取节点，区分导入声明、属性名和实际使用
    function inspect(node, parent, field) {
        if (!node || typeof node !== "object") {
            return;
        }
        if (node.type === "ImportDeclaration") {
            if (node.source.value.startsWith(".")) {
                checkReference(file, node.source.value);
            }
            for (const specifier of node.specifiers) {
                imported.push(specifier.local.name);
            }
            return;
        }
        if (node.type === "Identifier") {
            let isProperty = false;
            if (parent && parent.type === "MemberExpression" && field === "property" && !parent.computed) {
                isProperty = true;
            }
            if (!isProperty) {
                reads.add(node.name);
            }
        }
        if (node.type === "NewExpression" && node.callee.name === "URL") {
            const address = node.arguments[0];
            if (address && address.type === "Literal" && typeof address.value === "string" && address.value.startsWith("./")) {
                checkReference(file, address.value);
            }
        }
        for (const key of Object.keys(node)) {
            const value = node[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    inspect(child, node, key);
                }
            } else if (value && typeof value === "object") {
                inspect(value, node, key);
            }
        }
    }
    inspect(program, null, "");
    for (const name of imported) {
        if (!reads.has(name)) {
            problems.push(file + " 包含未使用的导入：" + name);
        }
    }
}

// 仅供模块内部使用的函数和常量不应继续暴露为公共接口
function checkUnusedExports() {
    for (const exported of moduleExports) {
        const namedImport = exported.file + "|" + exported.name;
        const namespaceImport = exported.file + "|*";
        if (!moduleImports.has(namedImport) && !moduleImports.has(namespaceImport)) {
            const file = path.relative(PROJECT_ROOT, exported.file);
            problems.push(file + " 包含没有调用方的导出：" + exported.name);
        }
    }
}

// 接口限制与 OpenAPI 一致，避免只改了常量却突破后端约束
function checkApiLimits() {
    const spec = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "openapi.json"), "utf8"));
    const schemas = spec.components.schemas;
    const limits = [
        [config.MAX_TAGS, schemas.NoteInput.properties.tags.maxItems],
        [config.MAX_TAG_LENGTH, schemas.NoteInput.properties.tags.items.maxLength],
        [config.MAX_IMAGES, schemas.NoteInput.properties.imageIds.maxItems],
        [config.MAX_BODY_LENGTH, schemas.NoteInput.properties.contentMarkdown.maxLength],
        [config.MAX_COMMENT_LENGTH, schemas.CommentInput.properties.body.maxLength],
        [config.MAX_PROFILE_LINKS, schemas.HomepageInput.properties.links.maxItems],
        [config.MAX_LINK_LABEL_LENGTH, schemas.HomepageInput.properties.links.items.properties.label.maxLength],
        [config.MAX_LINK_URL_LENGTH, schemas.HomepageInput.properties.links.items.properties.url.maxLength],
        [config.MAX_COLLECTION_NAME_LENGTH, schemas.CollectionInput.properties.name.maxLength]
    ];
    for (const limit of limits) {
        if (limit[0] !== limit[1]) {
            problems.push("config.js 中存在与 openapi.json 不一致的限制");
        }
    }
    const htmlLimits = [
        ["publish.html", "article-body", config.MAX_BODY_LENGTH],
        ["publish.html", "tags-text", config.MAX_TAG_LENGTH],
        ["index.html", "collection-name", config.MAX_COLLECTION_NAME_LENGTH]
    ];
    for (const limit of htmlLimits) {
        const source = fs.readFileSync(path.join(PROJECT_ROOT, limit[0]), "utf8");
        const elements = source.match(/<(?:input|textarea)\b[^>]*>/g) || [];
        let matched = false;
        for (const element of elements) {
            if (!element.includes('id="' + limit[1] + '"')) {
                continue;
            }
            const attribute = element.match(/maxlength="(\d+)"/);
            matched = Boolean(attribute && Number(attribute[1]) === limit[2]);
        }
        if (!matched) {
            problems.push(limit[0] + " 的 " + limit[1] + " 长度限制与 config.js 不一致");
        }
    }
}

// 检查项目文件名、模块和资源引用，开发工具作为独立运行入口保留
function main() {
    for (const folder of SOURCE_FOLDERS) {
        collect(folder);
    }
    for (const name of fs.readdirSync(PROJECT_ROOT)) {
        if (name.endsWith(".html")) {
            files.push(name);
        }
    }
    files.push("README.md");
    // 构建配置会读取跳转样式，也需要纳入引用检查
    checkModule("vite.config.js");
    for (const file of files) {
        const name = path.basename(file);
        if (file !== "README.md" && !/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+$/.test(name)) {
            problems.push("文件命名不规范：" + file);
        }
        if (file.endsWith(".js") || file.endsWith(".mjs")) {
            checkModule(file);
        } else if (file.endsWith(".html") || file.endsWith(".css") || file.endsWith(".md")) {
            checkTextReferences(file);
        }
    }
    for (const file of files) {
        if (file.startsWith("tools") || file.endsWith(".html") || file.endsWith(".md")) {
            continue;
        }
        if (!references.has(path.join(PROJECT_ROOT, file))) {
            problems.push("文件没有静态引用，请检查是否废弃：" + file);
        }
    }
    checkUnusedExports();
    checkApiLimits();
    for (const problem of problems) {
        console.error(problem);
    }
    if (problems.length > 0) {
        process.exitCode = 1;
        return;
    }
    console.log("项目检查通过：命名、模块引用、导出使用、样式语法、资源和接口限制");
}

main();
