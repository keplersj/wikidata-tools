/** A progress report from a running tool. `done`/`total` are present when the stage can be counted. */
export type Progress = { stage: string; done?: number; total?: number };
export type OnProgress = (progress: Progress) => void;
