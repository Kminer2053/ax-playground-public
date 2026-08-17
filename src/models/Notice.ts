import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * 공지 — 첫 접속 시 팝업으로 띄운다.
 *
 * 무로그인이라 "읽음"을 서버에 남길 수 없다. 브라우저가 `id:updatedAt`을 기억해 다시 띄우지 않되,
 * 공지를 고치면 updatedAt이 바뀌어 자동으로 다시 뜬다 — 내용이 달라졌는데 계속 숨어 있으면 안 된다.
 * (그래서 updatedAt을 켠다. 기존에는 createdAt만 있었다.)
 */
const NoticeSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    isActive: { type: Boolean, required: true, default: true, index: true },
    // 게시 기간 — 비우면 제한 없음. 지난 공지를 지우지 않고 자동으로 내리기 위한 것.
    startAt: { type: Date },
    endAt: { type: Date },
    // 본문 위에 띄울 이미지(선택). 폐쇄망이라 외부 URL이 아니라 /uploads/... 로컬 경로다.
    imageUrl: { type: String, default: "" },
    // 여러 건이 걸릴 때 위로 올릴 것(내림차순). 같으면 최신순.
    pinned: { type: Number, default: 0 },
    createdBy: { type: String },
  },
  { timestamps: true },
);

NoticeSchema.index({ isActive: 1, pinned: -1, createdAt: -1 });

export type NoticeDoc = InferSchemaType<typeof NoticeSchema>;
export const NoticeModel = models.Notice ?? model("Notice", NoticeSchema);
