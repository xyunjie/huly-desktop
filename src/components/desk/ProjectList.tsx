import { Avatar, Button, Empty, Input, Skeleton, Space, Table, Typography } from "antd";
import { PageTitle } from "./PageTitle";
import { useMemo, useState } from "react";
import { findPersonByRef } from "@/data/huly/mapping";
import { nameInitial } from "@/data/huly/mapping";
import { avatarColor, formatDue } from "@/domain/format";
import { canEditProject } from "@/domain/roles";
import type { Person, Project, Session } from "@/domain/types";

export function ProjectList({
  session,
  projects,
  people,
  loading,
  refreshing,
  error,
  onEnter,
  onAddMember,
  onEdit,
}: {
  session: Session;
  projects: Project[];
  people: Person[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onEnter: (projectId: string) => void;
  onAddMember: (project: Project) => void;
  onEdit: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const canEdit = canEditProject(session.role);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => `${project.identifier} ${project.name}`.toLowerCase().includes(needle));
  }, [projects, query]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <PageTitle
        extra={
          <>
            {refreshing ? <Typography.Text type="secondary">正在更新…</Typography.Text> : null}
            {loading ? <Typography.Text type="secondary">正在加载…</Typography.Text> : null}
            <Input
              size="small"
              allowClear
              value={query}
              placeholder="搜索项目名称或代号"
              style={{ width: 220, height: 28, marginLeft: "auto" }}
              onChange={(event) => setQuery(event.target.value)}
            />
          </>
        }
      >
        项目列表
      </PageTitle>
      {error ? <Typography.Paragraph type="danger" style={{ padding: "8px 20px 0" }}>{error}</Typography.Paragraph> : null}
      <div className="hd-page-body hd-table-wrap">
        {loading && projects.length === 0 ? (
          <div aria-busy="true" aria-label="正在加载项目列表">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : visible.length === 0 ? (
          <Empty description={query ? "没有匹配的项目。" : "这个工作区还没有项目。"} style={{ marginTop: 80 }}>
            {query ? null : (
              <Typography.Text type="secondary">可在 Huly 网页端创建，或等后续版本在此新建。</Typography.Text>
            )}
          </Empty>
        ) : (
          <Table
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={visible}
            data-testid="project-table"
            columns={[
              { title: "代号", dataIndex: "identifier", width: 120, render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
              { title: "名称", dataIndex: "name", ellipsis: true },
              {
                title: "任务数",
                width: 90,
                render: (_: unknown, project: Project) =>
                  project.issueCount === undefined ? "—" : `${project.openCount ?? "—"} / ${project.issueCount}`,
              },
              {
                title: "成员",
                width: 140,
                render: (_: unknown, project: Project) => <MemberAvatars ids={project.memberIds ?? []} people={people} />,
              },
              {
                title: "负责人",
                width: 120,
                render: (_: unknown, project: Project) => {
                  const lead = findPersonByRef(people, project.defaultAssigneeId) ?? findPersonByRef(people, project.ownerIds?.[0]);
                  return lead ? (
                    <Space size={6}>
                      <Avatar size={20} style={{ background: avatarColor(lead.id), fontSize: 11 }}>
                        {nameInitial(lead.name)}
                      </Avatar>
                      {lead.name}
                    </Space>
                  ) : (
                    "未设置"
                  );
                },
              },
              {
                title: "更新时间",
                width: 120,
                render: (_: unknown, project: Project) => formatDue(project.modifiedOn ?? null),
              },
              {
                title: "操作",
                width: canEdit ? 200 : 90,
                render: (_: unknown, project: Project) => (
                  <Space size={4}>
                    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onEnter(project.id)}>
                      进入项目
                    </Button>
                    {canEdit ? (
                      <>
                        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onAddMember(project)}>
                          添加成员
                        </Button>
                        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onEdit(project)}>
                          编辑
                        </Button>
                      </>
                    ) : null}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function MemberAvatars({ ids, people }: { ids: string[]; people: Person[] }) {
  const resolved = ids
    .map((id) => findPersonByRef(people, id))
    .filter((person): person is Person => Boolean(person));
  const shown = resolved.slice(0, 4);
  const extra = resolved.length - shown.length;
  if (shown.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((person, index) => (
        <Avatar
          key={person.id}
          size={22}
          style={{
            background: avatarColor(person.id),
            fontSize: 11,
            marginLeft: index === 0 ? 0 : -4,
            border: "2px solid #fff",
            zIndex: shown.length - index,
          }}
          alt={person.name}
        >
          {nameInitial(person.name)}
        </Avatar>
      ))}
      {extra > 0 ? (
        <Avatar size={22} style={{ background: "#d9d9d9", color: "#434343", fontSize: 11, marginLeft: -4, border: "2px solid #fff" }}>
          +{extra}
        </Avatar>
      ) : null}
    </span>
  );
}
