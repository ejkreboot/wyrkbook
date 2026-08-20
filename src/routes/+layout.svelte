<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { homeFor } from '$lib/nav';

	let { data, children } = $props();

	const profile = $derived(data.profile);
	const showChrome = $derived(!!profile && !page.url.pathname.endsWith('/print'));

	const links = $derived.by(() => {
		if (!profile) return [];
		if (profile.role === 'sysadmin') {
			return [{ href: '/sysadmin', label: 'Organizations' }];
		}
		if (profile.role === 'admin') {
			return [
				{ href: '/admin', label: 'This week' },
				{ href: '/admin/calendar', label: 'Calendar' },
				{ href: '/admin/plan', label: 'Plan' },
				{ href: '/admin/assignments', label: 'Assignments' },
				{ href: '/admin/classes', label: 'Classes' },
				{ href: '/admin/students', label: 'Students' }
			];
		}
		return [
			{ href: '/student', label: 'My work' },
			{ href: '/student/history', label: 'Finished' }
		];
	});

	function isActive(href: string) {
		const p = page.url.pathname;
		return href === p || (href !== '/admin' && href !== '/student' && p.startsWith(href + '/'));
	}
</script>

<svelte:head>
	<title>wyrkbook</title>
</svelte:head>

<div class="app">
	{#if showChrome}
		<header class="topbar">
			<div class="wrap topbar-inner">
				<a class="brand" href={homeFor(profile)}>
					<!-- Decorative: the wordmark beside it already names the app. -->
					<img class="brand-mark" src="/logo.png" alt="" width="400" height="311" />
					<span>wyrkbook<span class="dot">.</span></span>
				</a>
				<div class="spacer"></div>
				<div class="whoami">
					<strong>{profile?.display_name}</strong><span class="whoami-sep">·</span>{profile?.role}
				</div>
				<a class="btn btn-ghost btn-sm" href="/logout" data-sveltekit-preload-data="off">Sign out</a>
			</div>
		</header>

		{#if links.length > 1}
			<nav class="nav">
				<div class="wrap row" style="gap:.25rem">
					{#each links as l (l.href)}
						<a href={l.href} aria-current={isActive(l.href) ? 'page' : undefined}>{l.label}</a>
					{/each}
				</div>
			</nav>
		{/if}
	{/if}

	<main>
		{@render children()}
	</main>
</div>
