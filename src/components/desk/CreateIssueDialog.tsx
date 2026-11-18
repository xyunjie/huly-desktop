import { CloseOutlined } from "@ant-design/icons";
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Tag } from "antd";
import zhDatePicker from "antd/es/date-picker/locale/zh_CN";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { PRIORITY_LABEL, PRIORITY_ORDER } from "@/domain/priority";
import type {
  Component,
  CreateIssueInput,
  Issue,
  IssueTemplate,
  Label,
  Milestone,
  Person,
  Priority,
  Project,
  Status,
} from "@/domain/types";
import { StatusIcon } from "./StatusBadge";

export function CreateIssueDialog({
  open,
  mock,
  projects,
  projectId,
  statuses,
  people,
  milestones,
  components,
  labels = [],
  issues = [],
  templates = [],
  defaultParentId = null,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  mock: boolean;
  projects: Project[];
  projectId: string | null;
  statuses: Status[];
  people: Person[];
  milestones: Milestone[];
  components: Component[];
  labels?: Label[];
  issues?: Issue[];
  templates?: IssueTemplate[];
  defaultParentId?: string | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateIssueInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? "");
  const [statusId, setStatusId] = useState(statuses.find((item) => item.category === "todo")?.id ?? statuses[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState<string | null>(defaultParentId);
  const [dueDate, setDueDate] = useState<number | null>(null);
  const [estimationHours, setEstimationHours] = useState<number | undefined>(undefined);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProject(projectId ?? projects[0]?.id ?? "");
    setStatusId(statuses.find((item) => item.category === "todo")?.id ?? statuses[0]?.id ?? "");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssigneeId("");
    setMilestoneId("");
    setComponentId("");
    setLabelIds([]);
    setParentId(defaultParentId ?? null);
    setDueDate(null);
    setEstimationHours(undefined);
    setSelectedTemplateId(undefined);
    setError(null);
  }, [open, projectId, projects, statuses, defaultParentId]);

  function applyTemplate(templateId: string | undefined) {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tpl = templates.find((item) => item.id === templateId);
    if (!tpl) return;
    if (!title.trim()) setTitle(tpl.title);
    setDescription(tpl.description);
    setPriority(tpl.priority);
    setAssigneeId(tpl.assigneeId ?? "");
    setMilestoneId(tpl.milestoneId ?? "");
    setComponentId(tpl.componentId ?? "");
    setLabelIds([...tpl.labelIds]);
    setEstimationHours(tpl.estimationHours);
  }

  const activeParent = parentId ? issues.find((item) => item.id === parentId) ?? null : null;

  return (
    <Modal
      open={open}
      title={activeParent ? "新建子问题" : "新建任务"}
      onCancel={() => onOpenChange(false)}
      footer={null}
      width={620}
      destroyOnHidden
    >
      <p style={{ color: "#8c8c8c", marginTop: 0 }}>{mock ? "示例表单，不会写入服务器。" : "创建后会出现在当前项目里。"}</p>
      {activeParent ? (
        <div style={{ marginBottom: 12 }}>
          <Tag
            closable
            closeIcon={<CloseOutlined />}
            onClose={() => setParentId(null)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 13,
              background: "#f5f7fa",
              borderColor: "#dfe3e8",
            }}
          >
            <span style={{ color: "#6b778c" }}>上级任务</span>
            <strong>{activeParent.identifier}</strong>
            <span style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeParent.title}
            </span>
          </Tag>
        </div>
      ) : null}
      <Form
        layout="vertical"
        onFinish={() => {
          setBusy(true);
          setError(null);
          void onCreate({
            projectId: project,
            title,
            description,
            statusId,
            priority,
            assigneeId: assigneeId || null,
            milestoneId: milestoneId || null,
            componentId: componentId || null,
            labelIds,
            parentId,
            dueDate,
            estimationHours,
          })
            .then(() => onOpenChange(false))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "没有创建。"))
            .finally(() => setBusy(false));
        }}
      >
        {templates.length > 0 ? (
          <Form.Item label="套用模板（可选）">
            <Select
              allowClear
              placeholder="选择一个任务模板快速填充…"
              value={selectedTemplateId}
              options={templates.map((item) => ({ value: item.id, label: item.title }))}
              onChange={applyTemplate}
            />
          </Form.Item>
        ) : null}

        <Form.Item label="标题" required>
          <Input value={title} placeholder="简要描述要做的事" onChange={(event) => setTitle(event.target.value)} />
        </Form.Item>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Form.Item label="项目" style={{ marginBottom: 10 }}>
            <Select
              value={project}
              options={projects.map((item) => ({ value: item.id, label: `${item.identifier} ${item.name}` }))}
              onChange={(nextProject) => {
                setProject(nextProject);
                setParentId(null);
              }}
            />
          </Form.Item>
          <Form.Item label="状态" style={{ marginBottom: 10 }}>
            <Select
              value={statusId || undefined}
              placeholder="项目默认状态"
              options={statuses.map((item) => ({
                value: item.id,
                label: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <StatusIcon status={item} size={13} />
                    <span>{item.name}</span>
                  </span>
                ),
              }))}
              onChange={setStatusId}
            />
          </Form.Item>
          <Form.Item label="优先级" style={{ marginBottom: 10 }}>
            <Select
              value={priority}
              options={PRIORITY_ORDER.map((item) => ({ value: item, label: PRIORITY_LABEL[item] }))}
              onChange={(value) => setPriority(value as Priority)}
            />
          </Form.Item>
          <Form.Item label="指派人" style={{ marginBottom: 10 }}>
            <Select
              value={assigneeId}
              options={[{ value: "", label: "未指派" }, ...people.map((person) => ({ value: person.id, label: person.name }))]}
              onChange={setAssigneeId}
            />
          </Form.Item>
          <Form.Item label="里程碑" style={{ marginBottom: 10 }}>
            <Select
              value={milestoneId}
              options={[{ value: "", label: "无" }, ...milestones.map((item) => ({ value: item.id, label: item.name }))]}
              onChange={setMilestoneId}
            />
          </Form.Item>
          <Form.Item label="组件" style={{ marginBottom: 10 }}>
            <Select
              value={componentId}
              options={[{ value: "", label: "无" }, ...components.map((item) => ({ value: item.id, label: item.name }))]}
              onChange={setComponentId}
            />
          </Form.Item>
          <Form.Item label="截止日期" style={{ marginBottom: 10 }}>
            <DatePicker
              style={{ width: "100%" }}
              locale={zhDatePicker}
              placeholder="请选择日期"
              value={dueDate ? dayjs(dueDate) : null}
              onChange={(value) =>
                setDueDate(value ? value.hour(12).minute(0).second(0).millisecond(0).valueOf() : null)
              }
            />
          </Form.Item>
          <Form.Item label="估算工时 (h)" style={{ marginBottom: 10 }}>
            <InputNumber
              min={0}
              step={0.5}
              style={{ width: "100%" }}
              placeholder="例如 2.5"
              value={estimationHours}
              onChange={(value) => setEstimationHours(typeof value === "number" ? value : undefined)}
            />
          </Form.Item>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Form.Item label="上级任务（可选）" style={{ marginBottom: 12 }}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="作为顶级任务"
              value={parentId ?? undefined}
              options={issues
                .filter((item) => item.projectId === project)
                .map((item) => ({ value: item.id, label: `${item.identifier} ${item.title}` }))}
              onChange={(value) => setParentId(value ?? null)}
            />
          </Form.Item>
          <Form.Item label="标签" style={{ marginBottom: 12 }}>
            <Select
              mode="multiple"
              allowClear
              placeholder="选择标签"
              value={labelIds}
              options={labels.map((item) => ({ value: item.id, label: item.name }))}
              onChange={setLabelIds}
            />
          </Form.Item>
        </div>

        <Form.Item label="描述">
          <Input.TextArea
            value={description}
            placeholder="支持 Markdown（标题、列表、代码块、换行）"
            autoSize={{ minRows: 3, maxRows: 8 }}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Form.Item>

        {error ? <p style={{ color: "#cf1322" }}>{error}</p> : null}

        <Space>
          <Button type="primary" htmlType="submit" loading={busy} disabled={!title.trim() || !project}>
            {mock ? "创建（示例）" : "创建"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
        </Space>
      </Form>
    </Modal>
  );
}
