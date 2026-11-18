import { Dropdown, Input, Typography } from "antd";
import { useMemo, useState } from "react";
import { projectHeading } from "@/domain/format";
import type { Project } from "@/domain/types";

export function ProjectSwitcher({
  projects,
  projectId,
  onSelect,
}: {
  projects: Project[];
  projectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  const current = projects.find((project) => project.id === projectId);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => `${project.identifier} ${project.name}`.toLowerCase().includes(needle));
  }, [projects, query]);

  return (
    <Dropdown
      trigger={["click"]}
      onOpenChange={(open) => {
        if (open) setQuery("");
      }}
      popupRender={() => (
        <div
          data-testid="project-switcher-menu"
          style={{
            width: 280,
            background: "#fff",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            padding: 8,
          }}
        >
          <Input
            autoFocus
            allowClear
            placeholder="搜索项目"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {visible.map((project) => {
              const active = project.id === projectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelect(project.id)}
                  style={{
                    display: "flex",
                    width: "100%",
                    gap: 8,
                    border: 0,
                    background: active ? "#e8f1ff" : "transparent",
                    borderRadius: 6,
                    padding: "6px 8px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <Typography.Text strong style={{ flex: "none" }}>
                    {project.identifier}
                  </Typography.Text>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
                </button>
              );
            })}
            {visible.length === 0 ? <Typography.Text type="secondary">没有匹配的项目。</Typography.Text> : null}
          </div>
        </div>
      )}
    >
      <button
        type="button"
        data-testid="project-switcher"
        aria-label="切换项目"
        style={{
          border: 0,
          background: "transparent",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          padding: "0 4px",
        }}
      >
        {current ? `${projectHeading(current.identifier, current.name)} ▾` : "项目 ▾"}
      </button>
    </Dropdown>
  );
}
