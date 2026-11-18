import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, DatePicker, Input, Modal, Popconfirm, Select, Space, Tabs, Tag, Typography } from "antd";
import zhDatePicker from "antd/es/date-picker/locale/zh_CN";
import dayjs from "dayjs";
import { useState } from "react";
import { formatDue } from "@/domain/format";
import type {
  Component,
  ComponentInput,
  Milestone,
  MilestoneInput,
  MilestoneStatus,
  Person,
} from "@/domain/types";

const MILESTONE_STATUS_META: Record<MilestoneStatus, { label: string; color: string }> = {
  planned: { label: "计划中", color: "default" },
  "in-progress": { label: "进行中", color: "processing" },
  completed: { label: "已完成", color: "success" },
  canceled: { label: "已取消", color: "default" },
};

export function ProjectMetaModal({
  open,
  milestones,
  components,
  people,
  readOnly = false,
  onCancel,
  onCreateMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onCreateComponent,
  onUpdateComponent,
  onDeleteComponent,
}: {
  open: boolean;
  milestones: Milestone[];
  components: Component[];
  people: Person[];
  readOnly?: boolean;
  onCancel: () => void;
  onCreateMilestone: (input: MilestoneInput) => Promise<void>;
  onUpdateMilestone: (id: string, patch: Partial<MilestoneInput>) => Promise<void>;
  onDeleteMilestone: (id: string) => Promise<void>;
  onCreateComponent: (input: ComponentInput) => Promise<void>;
  onUpdateComponent: (id: string, patch: Partial<ComponentInput>) => Promise<void>;
  onDeleteComponent: (id: string) => Promise<void>;
}) {
  const [msEditingId, setMsEditingId] = useState<string | null>(null);
  const [msName, setMsName] = useState("");
  const [msStatus, setMsStatus] = useState<MilestoneStatus>("planned");
  const [msTargetDate, setMsTargetDate] = useState<number | null>(null);
  const [msDesc, setMsDesc] = useState("");

  const [cpEditingId, setCpEditingId] = useState<string | null>(null);
  const [cpName, setCpName] = useState("");
  const [cpLeadId, setCpLeadId] = useState<string | null>(null);
  const [cpDesc, setCpDesc] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetMilestoneForm() {
    setMsEditingId(null);
    setMsName("");
    setMsStatus("planned");
    setMsTargetDate(null);
    setMsDesc("");
  }

  function resetComponentForm() {
    setCpEditingId(null);
    setCpName("");
    setCpLeadId(null);
    setCpDesc("");
  }

  async function submitMilestone() {
    if (!msName.trim()) {
      setError("请填写里程碑名称。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: MilestoneInput = {
        name: msName.trim(),
        status: msStatus,
        targetDate: msTargetDate,
        description: msDesc.trim(),
      };
      if (msEditingId) {
        await onUpdateMilestone(msEditingId, payload);
      } else {
        await onCreateMilestone(payload);
      }
      resetMilestoneForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存里程碑失败。");
    } finally {
      setBusy(false);
    }
  }

  async function submitComponent() {
    if (!cpName.trim()) {
      setError("请填写组件名称。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: ComponentInput = {
        name: cpName.trim(),
        leadId: cpLeadId,
        description: cpDesc.trim(),
      };
      if (cpEditingId) {
        await onUpdateComponent(cpEditingId, payload);
      } else {
        await onCreateComponent(payload);
      }
      resetComponentForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存组件失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="管理里程碑与组件" onCancel={onCancel} footer={null} width={680} destroyOnHidden>
      {error ? (
        <Typography.Paragraph type="danger" style={{ marginBottom: 12 }}>
          {error}
        </Typography.Paragraph>
      ) : null}

      <Tabs
        items={[
          {
            key: "milestones",
            label: `里程碑 (${milestones.length})`,
            children: (
              <div style={{ display: "grid", gap: 14 }}>
                {!readOnly ? (
                  <div style={{ padding: 12, background: "#fafbfc", border: "1px solid #eceef2", borderRadius: 8, display: "grid", gap: 8 }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {msEditingId ? "编辑里程碑" : "新建里程碑"}
                    </Typography.Text>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 150px", gap: 8 }}>
                      <Input
                        placeholder="里程碑名称（如 v0.3 发布）"
                        value={msName}
                        onChange={(event) => setMsName(event.target.value)}
                      />
                      <Select
                        value={msStatus}
                        options={Object.entries(MILESTONE_STATUS_META).map(([value, meta]) => ({
                          value,
                          label: meta.label,
                        }))}
                        onChange={(value) => setMsStatus(value as MilestoneStatus)}
                      />
                      <DatePicker
                        locale={zhDatePicker}
                        placeholder="目标日期"
                        value={msTargetDate ? dayjs(msTargetDate) : null}
                        onChange={(value) =>
                          setMsTargetDate(
                            value ? value.hour(12).minute(0).second(0).millisecond(0).valueOf() : null,
                          )
                        }
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Input
                        placeholder="描述（可选）"
                        value={msDesc}
                        onChange={(event) => setMsDesc(event.target.value)}
                      />
                      <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={() => void submitMilestone()}>
                        {msEditingId ? "保存" : "添加"}
                      </Button>
                      {msEditingId ? (
                        <Button onClick={resetMilestoneForm}>取消</Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
                  {milestones.length === 0 ? (
                    <Typography.Text type="secondary">还没有里程碑。</Typography.Text>
                  ) : (
                    milestones.map((item) => {
                      const meta = MILESTONE_STATUS_META[item.status ?? "planned"];
                      return (
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
                              <Typography.Text strong>{item.name}</Typography.Text>
                              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                                {meta.label}
                              </Tag>
                              {item.targetDate ? (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  目标 {formatDue(item.targetDate)}
                                </Typography.Text>
                              ) : null}
                            </Space>
                            {item.description ? (
                              <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "4px 0 0" }}>
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
                                  setMsEditingId(item.id);
                                  setMsName(item.name);
                                  setMsStatus(item.status ?? "planned");
                                  setMsTargetDate(item.targetDate ?? null);
                                  setMsDesc(item.description ?? "");
                                }}
                              />
                              <Popconfirm
                                title="确认删除这个里程碑？"
                                okText="删除"
                                cancelText="取消"
                                onConfirm={() => void onDeleteMilestone(item.id)}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ),
          },
          {
            key: "components",
            label: `组件 (${components.length})`,
            children: (
              <div style={{ display: "grid", gap: 14 }}>
                {!readOnly ? (
                  <div style={{ padding: 12, background: "#fafbfc", border: "1px solid #eceef2", borderRadius: 8, display: "grid", gap: 8 }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {cpEditingId ? "编辑组件" : "新建组件"}
                    </Typography.Text>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 8 }}>
                      <Input
                        placeholder="组件名称（如 前端 / 登录）"
                        value={cpName}
                        onChange={(event) => setCpName(event.target.value)}
                      />
                      <Select
                        allowClear
                        placeholder="负责人"
                        value={cpLeadId ?? undefined}
                        options={people.map((person) => ({ value: person.id, label: person.name }))}
                        onChange={(value) => setCpLeadId(value ?? null)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Input
                        placeholder="描述（可选）"
                        value={cpDesc}
                        onChange={(event) => setCpDesc(event.target.value)}
                      />
                      <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={() => void submitComponent()}>
                        {cpEditingId ? "保存" : "添加"}
                      </Button>
                      {cpEditingId ? <Button onClick={resetComponentForm}>取消</Button> : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
                  {components.length === 0 ? (
                    <Typography.Text type="secondary">还没有组件。</Typography.Text>
                  ) : (
                    components.map((item) => {
                      const lead = item.leadId ? people.find((p) => p.id === item.leadId) : undefined;
                      return (
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
                              <Typography.Text strong>{item.name}</Typography.Text>
                              {lead ? (
                                <Tag style={{ marginInlineEnd: 0 }}>负责人：{lead.name}</Tag>
                              ) : null}
                            </Space>
                            {item.description ? (
                              <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "4px 0 0" }}>
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
                                  setCpEditingId(item.id);
                                  setCpName(item.name);
                                  setCpLeadId(item.leadId ?? null);
                                  setCpDesc(item.description ?? "");
                                }}
                              />
                              <Popconfirm
                                title="确认删除这个组件？"
                                okText="删除"
                                cancelText="取消"
                                onConfirm={() => void onDeleteComponent(item.id)}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
