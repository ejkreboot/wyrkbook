/**
 * markdown-it-container ships no types, and @types/markdown-it-container is
 * pinned to @types/markdown-it <14 — its MarkdownIt is not ours, so md.use()
 * rejects it. This is the v4 plugin's actual signature against the v14 types.
 */
declare module 'markdown-it-container' {
	import type MarkdownIt from 'markdown-it';
	import type { RendererRule } from 'markdown-it';

	export type ContainerOpts = {
		marker?: string;
		validate?(params: string, markup: string): boolean;
		render?: RendererRule;
	};

	export default function container(md: MarkdownIt, name: string, opts?: ContainerOpts): void;
}
