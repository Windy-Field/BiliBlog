import fs from "node:fs";

const navigationFile = new URL("./styles/navigation.css", import.meta.url);
const navigationStyles = fs.readFileSync(navigationFile, "utf8");

// 提前注入同站跳转声明，开发和构建共用同一份外部样式源码
function addNavigationStyles() {
    return [{
        tag: "style",
        children: navigationStyles,
        injectTo: "head-prepend"
    }];
}

// Vite 构建配置，各页面都作为入口
export default {
    plugins: [{
        name: "navigation-styles",
        transformIndexHtml: {
            order: "pre",
            handler: addNavigationStyles
        }
    }],
    build: {
        rolldownOptions: {
            input: {
                home: "index.html",
                login: "login.html",
                register: "register.html",
                publish: "publish.html",
                drafts: "drafts.html",
                profile: "profile.html",
                settings: "settings.html"
            }
        }
    }
};
