import { UserAddOutlined } from "@ant-design/icons";
import { Avatar, Button, Empty, Select, Skeleton, Space, Table, Tag, Typography, Popconfirm, message } from "antd";
import { PageTitle } from "./PageTitle";
import { nameInitial } from "@/data/huly/mapping";
import { avatarColor } from "@/domain/format";
import { canChangeWorkspaceRole, canRemoveWorkspaceMember } from "@/domain/members";
import { ASSIGNABLE_ROLES, ROLE_LABEL, canManageWorkspaceMembers, type WorkspaceRole } from "@/domain/roles";
import type { Session, WorkspaceMember } from "@/domain/types";

export function MemberAdmin({
  session,
  members,
  loading,
  refreshing,
  error,
  onInvite,
  onChangeRole,
  onRemove,
}: {
  session: Session;
  members: WorkspaceMember[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onInvite: () => void;
  onChangeRole: (accountId: string, role: WorkspaceRole) => Promise<void>;
  onRemove: (accountId: string) => Promise<void>;
}) {
  const manager = canManageWorkspaceMembers(session.role);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageTitle
        extra={
          <>
            {refreshing ? <Typography.Text type="secondary">正在更新…</Typography.Text> : null}
            {manager ? (
              <Button size="small" icon={<UserAddOutlined />} style={{ marginLeft: "auto", height: 28 }} onClick={onInvite} data-testid="invite-member">
                邀请成员
              </Button>
            ) : null}
          </>
        }
      >
        员工管理
      </PageTitle>
      {error ? <Typography.Paragraph type="danger" style={{ padding: "8px 20px 0" }}>{error}</Typography.Paragraph> : null}
      <div className="hd-page-body hd-table-wrap">
        {loading && members.length === 0 ? (
          <div aria-busy="true" aria-label="正在加载成员">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : members.length === 0 ? (
          <Empty description="还没有其他成员。" />
        ) : (
          <Table
            rowKey="accountId"
            size="middle"
            pagination={false}
            dataSource={members}
            columns={[
              {
                title: "姓名",
                render: (_: unknown, member: WorkspaceMember) => (
                  <Space>
                    <Avatar size={28} style={{ background: avatarColor(member.accountId), fontSize: 12 }}>
                      {nameInitial(member.name)}
                    </Avatar>
                    {member.name}
                  </Space>
                ),
              },
              { title: "邮箱", dataIndex: "email", render: (value: string | undefined) => value || "—" },
              {
                title: "角色",
                width: 140,
                render: (_: unknown, member: WorkspaceMember) => {
                  const color =
                    member.role === "OWNER" || member.role === "ADMIN"
                      ? "gold"
                      : member.role === "MAINTAINER"
                        ? "blue"
                        : member.role === "GUEST" || member.role === "DocGuest" || member.role === "READONLYGUEST"
                          ? "purple"
                          : "default";
                  return <Tag color={color}>{ROLE_LABEL[member.role]}</Tag>;
                },
              },
              {
                title: "状态",
                width: 90,
                render: (_: unknown, member: WorkspaceMember) =>
                  member.active ? <Typography.Text type="success">在职</Typography.Text> : <Typography.Text type="danger">停用</Typography.Text>,
              },
              {
                title: "操作",
                width: 220,
                render: (_: unknown, member: WorkspaceMember) => (
                  <MemberActions
                    session={session}
                    member={member}
                    members={members}
                    onChangeRole={onChangeRole}
                    onRemove={onRemove}
                  />
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function MemberActions({
  session,
  member,
  members,
  onChangeRole,
  onRemove,
}: {
  session: Session;
  member: WorkspaceMember;
  members: WorkspaceMember[];
  onChangeRole: (accountId: string, role: WorkspaceRole) => Promise<void>;
  onRemove: (accountId: string) => Promise<void>;
}) {
  const change = canChangeWorkspaceRole({
    actorRole: session.role,
    target: member,
    nextRole: member.role === "USER" ? "MAINTAINER" : "USER",
    members,
  });
  const remove = canRemoveWorkspaceMember({
    actorRole: session.role,
    actorAccountId: session.accountId ?? "",
    target: member,
    members,
  });
  if (!canManageWorkspaceMembers(session.role)) {
    return <Typography.Text type="secondary">暂不支持</Typography.Text>;
  }
  return (
    <Space size={8}>
      <Select
        size="small"
        style={{ width: 110 }}
        value={member.role}
        aria-label={`修改 ${member.name} 的角色`}
        options={ASSIGNABLE_ROLES.map((role) => ({
          value: role,
          label: ROLE_LABEL[role],
          disabled: !canChangeWorkspaceRole({ actorRole: session.role, target: member, nextRole: role, members }).ok,
        }))}
        onChange={(role) => {
          void onChangeRole(member.accountId, role as WorkspaceRole).catch((reason) => {
            message.error(reason instanceof Error ? reason.message : "没有改成。");
          });
        }}
      />
      {remove.ok ? (
        <Popconfirm
          title={`确定移除 ${member.name}？`}
          okText="移除"
          cancelText="取消"
          onConfirm={() =>
            onRemove(member.accountId).catch((reason) => {
              message.error(reason instanceof Error ? reason.message : "没有移除。");
            })
          }
        >
          <Button type="link" size="small" danger style={{ padding: 0 }}>
            移除
          </Button>
        </Popconfirm>
      ) : (
        <Typography.Text type="secondary">{remove.reason === "不能移除自己" ? "不能移除自己" : "暂不支持"}</Typography.Text>
      )}
      {change.ok ? null : null}
    </Space>
  );
}
