import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_ORDER } from "@/domain/priority";
import type {
  Component,
  IssueTemplate,
  IssueTemplateInput,
  Label,
  Milestone,
  Person,
  Priority,
} from "@/domain/types";

export function TemplateModal({
  open,
  templates,
  people,
  milestones,
  components,
  labels,
  readOnly = false,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  templates: IssueTemplate[];
  people: Person[];
  milestones: Milestone[];
  components: Component[];
  labels: Label[];
  readOnly?: boolean;
  onCancel: () => void;
  onCreate: (input: IssueTemplateInput) => Promise<void>;
  onUpdate: (id: string, patch: Partial<IssueTemplateInput>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [componentId, setComponentId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [estimationHours, setEstimationHours] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssigneeId(null);
    setMilestoneId(null);
    setComponentId(null);
    setLabelIds([]);
    setEstimationHours(undefined);
  }

  async function submit() {
    if (!title.trim()) {
      setError("请填写模板名称。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: IssueTemplateInput = {
        title: title.trim(),
        description,
        priority,
        assigneeId,
        milestoneId,
        componentId,
        labelIds,
        estimationHours,
      };
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onCreate(payload);
      }
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存模板失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="任务模板" onCancel={onCancel} footer={null} width={700} destroyOnHidden>
      {error ? (
        <Typography.Paragraph type="danger" style={{ marginBottom: 12 }}>
          {error}
        </Typography.Paragraph>
      ) : null}

      {!readOnly ? (
        <div style={{ padding: 12, background: "#fafbfc", border: "1px solid #eceef2", borderRadius: 8, display: "grid", gap: 10, marginBottom: 16 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {editingId ? "编辑模板" : "新建模板"}
          </Typography.Text>
          <Input
            placeholder="模板名称 / 默认标题（如：线上缺陷排查模板）"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Select
              value={priority}
              options={PRIORITY_ORDER.map((item) => ({ value: item, label: `优先级：${PRIORITY_LABEL[item]}` }))}
              onChange={(value) => setPriority(value as Priority)}
            />
            <Select
              allowClear
              placeholder="默认指派人"
              value={assigneeId ?? undefined}
              options={people.map((person) => ({ value: person.id, label: person.name }))}
              onChange={(value) => setAssigneeId(value ?? null)}
            />
            <InputNumber
              min={0}
              step={0.5}
              placeholder="默认估算(h)"
              style={{ width: "100%" }}
              value={estimationHours}
              onChange={(value) => setEstimationHours(typeof value === "number" ? value : undefined)}
            />
            <Select
              allowClear
              placeholder="默认里程碑"
              value={milestoneId ?? undefined}
              options={milestones.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(value) => setMilestoneId(value ?? null)}
            />
            <Select
              allowClear
              placeholder="默认组件"
              value={componentId ?? undefined}
              options={components.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(value) => setComponentId(value ?? null)}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="默认标签"
              value={labelIds}
              options={labels.map((item) => ({ value: item.id, label: item.name }))}
              onChange={setLabelIds}
            />
          </div>
          <Input.TextArea
            placeholder="默认 Markdown 描述（支持标题、列表、检查清单）"
            autoSize={{ minRows: 3 }}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Space>
            <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={() => void submit()}>
              {editingId ? "保存模板" : "创建模板"}
            </Button>
            {editingId ? <Button onClick={resetForm}>取消</Button> : null}
          </Space>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8, maxHeight: 280, overflow: "auto" }}>
        {templates.length === 0 ? (
          <Typography.Text type="secondary">当前项目还没有任务模板。</Typography.Text>
        ) : (
          templates.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                border: "1px solid #eceef2",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Space size={8}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Tag color={PRIORITY_COLOR[item.priority]} style={{ marginInlineEnd: 0 }}>
                    {PRIORITY_LABEL[item.priority]}
                  </Tag>
                  {item.estimationHours ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      估算 {item.estimationHours}h
                    </Typography.Text>
                  ) : null}
                </Space>
                {item.description ? (
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ fontSize: 12, margin: "4px 0 0" }}
                  >
                    {item.description}
                  </Typography.Paragraph>
                ) : null}
              </div>
              {!readOnly ? (
                <Space size={4}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditingId(item.id);
                      setTitle(item.title);
                      setDescription(item.description);
                      setPriority(item.priority);
                      setAssigneeId(item.assigneeId);
                      setMilestoneId(item.milestoneId);
                      setComponentId(item.componentId);
                      setLabelIds(item.labelIds);
                      setEstimationHours(item.estimationHours);
                    }}
                  />
                  <Popconfirm
                    title="确认删除这个模板？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void onDelete(item.id)}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
