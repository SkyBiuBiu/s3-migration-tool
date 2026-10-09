# DESIGN

## Direction & Layout
- 运维工具风格：冷静、高信息密度、数据优先。第一屏的核心视觉是顶部深色控制台条加上任务进度条。参考对象：AWS Console 和 Rclone GUI。
- 页面最大宽度 1200px。三个标签页（存储连接、对象浏览、迁移任务）。卡片间距 16px。移动端：表格可横向滚动，表单改为单列。
- 应做：使用等宽字体显示 key 和尺寸，状态徽章要清晰。不应做：渐变、玻璃拟态、装饰性大图。

## Tokens
- 颜色：背景 #F4F6F5，表面 #FFFFFF，顶栏 #12201B，主色 #0F766E（青绿），文字 #14201C / #5B6B66，成功色 #15803D，警告色 #B45309，错误色 #B91C1C。
- 字体：标题用 IBM Plex Sans 600（24/20/16px），正文 14px/1.5，key 用 JetBrains Mono 13px。
- 圆角：卡片 8px，按钮和输入框 6px。间距按 4px 递进。卡片使用 1px #DDE3E0 边框，不加阴影。

## Shared Patterns & States
- 卡片、表格、状态徽章（pending、running、completed、failed、cancelled）、进度条。
- 加载中显示加载动画，无数据时显示空状态文案，出错时使用 toast 提示和行内红色文字。按钮点击区域至少 36px，可聚焦元素显示 2px 主色焦点环。
- 动效：只用于进度条宽度过渡，时长 200ms。

## Media
- 运维型界面，不需要图片。
