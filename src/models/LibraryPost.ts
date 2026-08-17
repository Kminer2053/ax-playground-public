import { Schema, model, models, type InferSchemaType } from "mongoose";

/** 투표자(익명) — 클라이언트 localStorage voterId 기반 중복/토글. */
const VoterSchema = new Schema(
  { id: { type: String, required: true }, dir: { type: String, enum: ["up", "down"], required: true } },
  { _id: false },
);

/** 첨부파일(자료실 다중첨부). 실파일은 디스크(public/uploads), 여기엔 메타만. */
const AttachmentSchema = new Schema(
  { name: { type: String, required: true }, size: { type: Number, default: 0 }, url: { type: String, required: true } },
  { _id: false },
);

/** 댓글 — 게시글 문서에 내장. _id로 개별 삭제. passwordHash 있으면 본인 삭제 가능. */
const CommentSchema = new Schema(
  {
    author: { type: String, required: true, maxlength: 24 },
    content: { type: String, required: true, maxlength: 1000 },
    passwordHash: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * AX 라이브러리 게시물 (P4). 3개 보드 통합.
 *  - prompt: 프롬프트 도서관 (content=프롬프트, usage=사용방법, thumbnailUrl 선택)
 *  - video : 영상 자료실 (fileUrl=mp4, thumbnailUrl=포스터)
 *  - file  : 자료실 (attachments[]=다중첨부)
 * 로그인 없음 → 작성자/투표자 익명. 수정·삭제는 passwordHash 또는 관리자(isAdmin).
 */
const LibraryPostSchema = new Schema(
  {
    board: { type: String, required: true, enum: ["prompt", "video", "file"], index: true },
    title: { type: String, required: true, maxlength: 200 },
    content: { type: String, required: true },
    usage: { type: String, default: "" },
    author: { type: String, required: true, maxlength: 24 },
    thumbnailUrl: { type: String, default: "" },
    fileUrl: { type: String, default: "" },
    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    attachments: { type: [AttachmentSchema], default: [] },
    passwordHash: { type: String, default: "" },
    comments: { type: [CommentSchema], default: [] },
    up: { type: Number, default: 0, index: true },
    down: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },
    voters: { type: [VoterSchema], default: [] },
    pinned: { type: Boolean, default: false, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

// 목록(고정 우선·최신), 인기(좋아요순), 조회순 정렬용.
LibraryPostSchema.index({ board: 1, pinned: -1, createdAt: -1 });
LibraryPostSchema.index({ board: 1, up: -1, createdAt: -1 });
LibraryPostSchema.index({ board: 1, viewCount: -1, createdAt: -1 });

export type LibraryPostDoc = InferSchemaType<typeof LibraryPostSchema>;
export const LibraryPostModel = models.LibraryPost ?? model("LibraryPost", LibraryPostSchema);
