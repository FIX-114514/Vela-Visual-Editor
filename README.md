# Vela-Visual-Editor
VS Code扩展，可以用于AIoT IDE，旨在用图形化界面帮助开发者预览VelaJS中temple的布局

该扩展为半成品，在找到合适的画布渲染办法前不会更新，也不会发布该扩展。

---

该扩展存在的问题：

1.不推荐在画布或源码中使用if/show，这在画布上存在渲染问题。

2.不推荐将多个页面整合到一个文件中，这在画布上存在渲染问题。

注意：该扩展不是模拟器，因此与实际渲染界面存在差异。

---

## 使用说明

### 下载项目代码

```bash
git clone https://github.com/FIX-114514/Vela-Visual-Editor.git
```

### 打包项目

在VS Code中运行`vsce package`，打包成*.vsix文件以便在AIoT IDE中安装扩展
