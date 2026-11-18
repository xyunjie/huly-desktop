import { CheckSquareOutlined, ProjectOutlined, TeamOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Menu, Typography } from "antd";
import { nameInitial } from "@/data/huly/mapping";
import { avatarColor } from "@/domain/format";
import { canManageWorkspaceMembers } from "@/domain/roles";
import type { Session } from "@/domain/types";

export type DeskNav = "projects" | "mine" | "members" | "profile" | "project";

export function Sidebar({
  session,
  nav,
  onNav,
  onSwitchWorkspace,
  onLogout,
}: {
  session: Session;
  nav: DeskNav;
  onNav: (nav: Exclude<DeskNav, "project">) => void;
  onSwitchWorkspace: (workspaceUrl: string) => void;
  onLogout: () => void;
}) {
  const workspaces = session.workspaces ?? [];
  const showMembers = canManageWorkspaceMembers(session.role);
  const selected = nav === "projects" || nav === "mine" || nav === "members" ? [nav] : [];
  return (
    <div className="hd-sider" style={{ height: "100%", display: "flex", flexDirection: "column", background: "#f7f8fa" }}>
      <div style={{ padding: "20px 20px 16px" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", lineHeight: "20px" }}>
          工作区
        </Typography.Text>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: "26px", color: "#172b4d" }}>{session.workspaceName}</div>
      </div>
      <div style={{ overflow: "auto", flex: 1, paddingTop: 4 }}>
        <Menu
          mode="inline"
          selectedKeys={selected}
          items={[
            {
              key: "projects",
              icon: <ProjectOutlined />,
              label: <span data-testid="nav-projects">项目列表</span>,
            },
            {
              key: "mine",
              icon: <CheckSquareOutlined />,
              label: <span data-testid="nav-mine">我的任务</span>,
            },
            ...(showMembers
              ? [
                  {
                    key: "members",
                    icon: <TeamOutlined />,
                    label: <span data-testid="nav-members">员工管理</span>,
                  },
                ]
              : []),
          ]}
          onClick={({ key }) => {
            if (key === "projects" || key === "mine" || key === "members") {
              onNav(key);
            }
          }}
        />
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", padding: 10 }}>
        <Dropdown
          trigger={["click"]}
          placement="topLeft"
          destroyOnHidden
          menu={{
            items: [
              {
                key: "switch",
                label: "切换工作区",
                children: workspaces.map((workspace) => ({
                  key: `ws:${workspace.url}`,
                  label: workspace.name,
                  extra: workspace.url === session.workspace ? "✓" : undefined,
                })),
              },
              { key: "profile", label: "个人中心" },
              { type: "divider" },
              { key: "logout", label: "退出登录", danger: true },
            ],
            onClick: ({ key }) => {
              if (key === "profile") onNav("profile");
              if (key === "logout") onLogout();
              if (key.startsWith("ws:")) {
                const url = key.slice(3);
                if (url !== session.workspace) onSwitchWorkspace(url);
              }
            },
          }}
        >
          <button
            type="button"
            className="hd-account-btn"
            data-testid="account-menu"
            aria-label="账号菜单"
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              gap: 10,
              border: 0,
              background: "transparent",
              borderRadius: 8,
              padding: "8px 10px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Avatar size={32} style={{ background: avatarColor(session.userId ?? session.userName), flex: "none", fontSize: 14 }}>
              {nameInitial(session.userName)}
            </Avatar>
            <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {session.userName}
            </span>
          </button>
        </Dropdown>
      </div>
    </div>
  );
}
