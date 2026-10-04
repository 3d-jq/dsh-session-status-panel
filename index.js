/**
 * 会话状态面板 —— 宿主半区。
 *
 * 目前是空壳：面板需要的一切都从 DSH 已有的会话投影与客户端服务读取，不需要宿主侧数据通道。
 * （曾经这里注册过一个只读的 git 状态路由给"更改"分区用；该分区已按用户要求移除，
 *  路由一并删掉——不留没有消费者的网络端点。）
 *
 * 后续若要在面板里加需要宿主侧数据的分区，入口就在这里：
 * `ctx.webServer.register({ kind: 'exact', path, handler })`，并注意路由要自带信任校验
 * （回环 Host / 同源 Origin，任何解析异常一律拒绝），可参考 `dsh-whale-widget` 的 registerRoute 包装。
 */

export const name = 'dsh-session-status-panel';

export function apply() {}
