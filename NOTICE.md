# NOTICE / 归属声明

本插件的**代码为独立实现**（MIT，见 `LICENSE`），但**版式、交互与信息优先级派生自以下开源项目**，
按上游许可（Apache License 2.0）在此声明来源：

- **ZCode** — `https://github.com/zai-org/ZCode`（Apache License 2.0）
  - 参照来源：`packages/ui/src/v4/ConversationStatusPanel.tsx`、
    `packages/ui/src/v4/conversationStatusPanelModel.ts`、`packages/ui/src/v4/conversationLayout.ts`。
  - 参照内容：收起态胶囊的摘要优先级链、展开态分区的标题栏形态（图标 + 标题 + 尾随计数 + 折叠箭头）、
    待办列表的 3 项聚焦窗口与「前面/后面 N 项」折叠规则、分区之间的分隔线规则。
  - 未复制其代码：本插件的浏览器半区为纯 JavaScript + `React.createElement` 的原创实现，
    数据全部来自 DeepSeek Harness 自己的会话投影与客户端服务，不依赖 ZCode 的任何包或类型。

- **DeepSeek Harness (DSH)** — `https://github.com/deepseek-ai/deepseek-harness`
  - 插件形态、slot 契约、会话投影与服务 API 均以其官方 `cordis-plugin-development` 技能与源码为准。

本插件的名字、包名与 ZCode 项目不存在隶属关系；上游名称与商标归其各自所有者。
