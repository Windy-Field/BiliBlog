// Vite 构建配置，各页面都作为入口
export default {
    build: {
        rolldownOptions: {
            input: {
                home: "index.html",
                login: "login.html",
                register: "register.html",
                publish: "publish.html",
                profile: "profile.html",
                settings: "settings.html"
            }
        }
    }
};
