/**
 * dsh-approval-popup — global in-app layer.
 *
 * The host owns the pending approval. This layer polls the host bridge so the
 * modal appears globally for any conversation. The native Windows dialog is
 * opened by the host when this poll reports a hidden window; whichever surface
 * answers first wins, and the other disappears on the next poll.
 */
window.__ModuleLoader__.load({
	id: "dsh-approval-popup",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;
		const { useEffect, useRef, useState } = React;
		const NS = "approvalPopup";

		const zh = {
			title: "权限提升请求",
			lead: "模型请求以更高权限执行本次操作。批准只对这一次生效。",
			badge: "仅本次生效",
			reason: "申请说明",
			tool: "发起工具",
			conversation: "对话",
			workspace: "工作区",
			allow: "允许一次",
			reject: "拒绝",
			highRisk: "高危请求",
			highRiskHint: "高危请求：请用鼠标点击「允许一次」。",
			hint: "←/→ 选择 · Enter 确认，也可鼠标点击",
			submitting: "处理中…",
			error: "提交失败，请求仍在等待。请重试。",
			fallbackReason: "工具请求越权执行本次操作。",
			"settings.title": "权限审批",
			"settings.desc": "控制哪些提权请求会以高危模式呈现；关闭识别后所有请求都按常规处理。",
			"settings.enabled": "启用高危识别",
			"settings.enabledDesc": "总开关；关闭后不再分析命令，也不显示高危样式。",
			"settings.delete": "删除文件",
			"settings.deleteDesc": "Remove-Item、del、rm、.NET Delete 等。",
			"settings.registry": "注册表修改",
			"settings.registryDesc": "reg add/delete、HKLM/HKCU、Registry SetValue 等。",
			"settings.systemFiles": "系统文件",
			"settings.systemFilesDesc": "System32、Windows、Program Files、ProgramData、hosts 等。",
			"settings.permissions": "权限与 ACL",
			"settings.permissionsDesc": "takeown、icacls、Set-Acl、Set-ExecutionPolicy 等。",
			"settings.disk": "磁盘/启动/服务",
			"settings.diskDesc": "diskpart、format、bcdedit、shutdown、sc delete 等。",
			"settings.dynamic": "动态执行",
			"settings.dynamicDesc": "Invoke-Expression、iex 等无法静态分析的命令。",
			"settings.saved": "已保存",
			"settings.saving": "保存中…",
			"settings.error": "保存失败，请重试。",
			"settings.loading": "加载中…",
			"settings.off": "高危识别已关闭",
			"settings.types": "识别类型",
			"settings.colors": "常规请求颜色",
			"settings.highRiskColor": "高危请求颜色",
			"settings.color.deepBlue": "深海蓝",
			"settings.color.skyBlue": "晴空蓝",
			"settings.color.emerald": "翡翠绿",
			"settings.color.amber": "琥珀黄",
			"settings.color.alertRed": "警示红",
			"settings.colorDefault": "默认",
			"settings.colorHint": "高危请求固定使用警示红，不可修改。",
			"settings.outside": "应用外申请推送",
			"settings.outside.off": "关闭",
			"settings.outside.offDesc": "不显示任何应用外提示，回到应用后再处理。",
			"settings.outside.notification": "系统通知",
			"settings.outside.notificationDesc": "右下角滑入通知，点击切回 DSH；不直接审批，会自动消失。",
			"settings.outside.window": "顶级窗口",
			"settings.outside.windowDesc": "弹出可审批的原生窗口。",
			"settings.disableHighRiskTitle": "关闭高危识别？",
			"settings.disableHighRiskBody": "关闭后，所有权限请求都会按常规处理：不再标红、不再禁用键盘批准，也不区分高危类别。",
			"settings.cancel": "取消",
			"settings.confirmDisable": "确认关闭"
		};

		const en = {
			title: "Permission escalation request",
			lead: "The model wants to run this operation with wider permissions. Approval applies to this one call only.",
			badge: "This call only",
			reason: "Reason",
			tool: "Requested by",
			conversation: "Conversation",
			workspace: "Workspace",
			allow: "Allow once",
			reject: "Reject",
			highRisk: "HIGH RISK",
			highRiskHint: "High-risk: use the mouse to click Allow once.",
			hint: "←/→ select · Enter confirm, or click",
			submitting: "Submitting…",
			error: "Could not submit the decision; the request is still waiting. Try again.",
			fallbackReason: "A tool requests privileged execution for this operation.",
			"settings.title": "Permission approvals",
			"settings.desc": "Choose which escalation requests use the high-risk presentation. Turning detection off makes every request normal.",
			"settings.enabled": "Enable high-risk detection",
			"settings.enabledDesc": "Master switch; when off, commands are not analyzed and no high-risk styling is shown.",
			"settings.delete": "File deletion",
			"settings.deleteDesc": "Remove-Item, del, rm, .NET Delete, and similar.",
			"settings.registry": "Registry changes",
			"settings.registryDesc": "reg add/delete, HKLM/HKCU, Registry SetValue, and similar.",
			"settings.systemFiles": "System files",
			"settings.systemFilesDesc": "System32, Windows, Program Files, ProgramData, hosts, and similar.",
			"settings.permissions": "Permissions and ACLs",
			"settings.permissionsDesc": "takeown, icacls, Set-Acl, Set-ExecutionPolicy, and similar.",
			"settings.disk": "Disk, boot, and services",
			"settings.diskDesc": "diskpart, format, bcdedit, shutdown, sc delete, and similar.",
			"settings.dynamic": "Dynamic execution",
			"settings.dynamicDesc": "Invoke-Expression, iex, and other commands that cannot be statically analyzed.",
			"settings.saved": "Saved",
			"settings.saving": "Saving…",
			"settings.error": "Could not save. Try again.",
			"settings.loading": "Loading…",
			"settings.off": "High-risk detection is off",
			"settings.types": "Detection types",
			"settings.colors": "Normal request color",
			"settings.highRiskColor": "High-risk request color",
			"settings.color.deepBlue": "Deep blue",
			"settings.color.skyBlue": "Sky blue",
			"settings.color.emerald": "Emerald",
			"settings.color.amber": "Amber",
			"settings.color.alertRed": "Alert red",
			"settings.colorDefault": "Default",
			"settings.colorHint": "High-risk requests always use Alert red; this cannot be changed.",
			"settings.outside": "Outside-app approval alerts",
			"settings.outside.off": "Off",
			"settings.outside.offDesc": "Show nothing outside the app; handle the request when you return.",
			"settings.outside.notification": "System notification",
			"settings.outside.notificationDesc": "Slide in at the bottom-right and click to return to DSH. It never approves and closes automatically.",
			"settings.outside.window": "Top-level window",
			"settings.outside.windowDesc": "Open the native window where the request can be approved.",
			"settings.disableHighRiskTitle": "Turn off high-risk detection?",
			"settings.disableHighRiskBody": "All permission requests will be treated as normal requests: no red styling, no keyboard approval lockout, and no risk categories.",
			"settings.cancel": "Cancel",
			"settings.confirmDisable": "Turn off"
		};

		const styles = {
			overlay: {
				position: "fixed",
				inset: 0,
				zIndex: 10000,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 16,
				background: "rgba(15, 23, 42, 0.55)",
				backdropFilter: "blur(3px)"
			},
			card: {
				width: "min(94vw, 640px)",
				maxHeight: "min(86vh, 760px)",
				overflowY: "auto",
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "column",
				gap: "clamp(12px, 1.6vh, 18px)",
				padding: "clamp(18px, 2.4vw, 26px)",
				borderRadius: 16,
				border: "1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.35))",
				background: "var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #ffffff))",
				color: "var(--dsw-alias-label-primary, #111827)",
				boxShadow: "0 24px 60px rgba(0, 0, 0, 0.28)"
			},
			cardHighRisk: {
				background: "rgba(230, 0, 18, 0.82)",
				border: "1px solid rgba(255, 255, 255, 0.25)"
			},
			header: { display: "flex", flexDirection: "column", gap: 4 },
			title: { margin: 0, fontSize: 18, fontWeight: 600, lineHeight: "26px" },
			lead: { margin: 0, fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-secondary, #4b5563)" },
			body: { display: "flex", flexDirection: "column", gap: 12 },
			footer: {
				display: "flex",
				justifyContent: "flex-end",
				flexWrap: "wrap",
				gap: 8,
				marginTop: 2
			},
			button: {
				height: 36,
				padding: "0 16px",
				borderRadius: 999,
				border: "1px solid transparent",
				font: "inherit",
				fontSize: 13,
				fontWeight: 500,
				cursor: "pointer"
			},
			buttonPrimary: {
				background: "var(--dsw-alias-button-primary-fill, #2563eb)",
				color: "#ffffff"
			},
			buttonOutline: {
				background: "transparent",
				color: "var(--dsw-alias-label-primary, #111827)",
				borderColor: "var(--dsw-alias-border-l2, #cbd5e1)"
			},
			buttonHighRiskPrimary: { background: "#ffffff", color: "#b91c1c" },
			buttonHighRiskOutline: {
				background: "transparent",
				color: "#ffffff",
				borderColor: "rgba(255, 255, 255, 0.65)"
			},
			buttonDisabled: { opacity: 0.55, cursor: "default" },
			selectedButton: { boxShadow: "0 0 0 3px #f59e0b", outline: "none" },
			reasonBlock: {
				background: "linear-gradient(135deg, #1e293b, #0f172a)",
				border: "1px solid rgba(148, 163, 184, 0.35)",
				borderLeft: "3px solid #3b82f6",
				borderRadius: 10,
				padding: "10px 12px 10px 13px",
				maxHeight: "min(38vh, 380px)",
				overflowY: "auto"
			},
			reasonBlockHighRisk: {
				background: "rgba(255, 255, 255, 0.94)",
				border: "1px solid rgba(220, 38, 38, 0.25)",
				borderLeft: "3px solid #dc2626"
			},
			reasonLabel: { color: "#ffffff", fontSize: 12, fontWeight: 600, lineHeight: "18px", marginBottom: 4 },
			reason: {
				color: "#ffffff",
				fontSize: 13,
				lineHeight: "20px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				overflowWrap: "anywhere"
			},
			meta: { display: "flex", flexDirection: "column", gap: 4 },
			metaRow: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 },
			metaLabel: {
				flex: "none",
				width: 48,
				color: "var(--dsw-alias-label-tertiary, #6b7280)",
				fontSize: 12,
				lineHeight: "18px"
			},
			metaValue: {
				color: "var(--dsw-alias-label-secondary, #4b5563)",
				fontSize: 12,
				lineHeight: "18px",
				wordBreak: "break-all"
			},
			metaValueStrong: {
				color: "var(--dsw-alias-label-primary, #111827)",
				fontSize: 13,
				fontWeight: 600,
				lineHeight: "18px",
				wordBreak: "break-all"
			},
			tool: {
				color: "#1d4ed8",
				background: "rgba(59, 130, 246, 0.10)",
				border: "1px solid rgba(59, 130, 246, 0.20)",
				borderRadius: 6,
				padding: "1px 7px",
				fontFamily: "var(--ds-font-family-code)",
				fontSize: 12,
				lineHeight: "18px"
			},
			badge: {
				alignSelf: "flex-start",
				color: "#1d4ed8",
				background: "rgba(59, 130, 246, 0.10)",
				border: "1px solid rgba(59, 130, 246, 0.22)",
				borderRadius: 999,
				padding: "1px 9px",
				fontSize: 11,
				lineHeight: "18px"
			},
			hint: { color: "var(--dsw-alias-label-tertiary, #6b7280)", fontSize: 12, lineHeight: "18px" },
			error: { color: "var(--dsw-alias-state-error-primary, #dc2626)", fontSize: 12, lineHeight: "18px" },
			highRiskBadge: {
				alignSelf: "flex-start",
				color: "#ffffff",
				background: "#dc2626",
				border: "1px solid #b91c1c",
				borderRadius: 999,
				padding: "1px 10px",
				fontSize: 11,
				fontWeight: 700,
				lineHeight: "18px"
			},
			highRiskHint: { color: "#b91c1c", fontSize: 12, fontWeight: 600, lineHeight: "18px" },
			warningRow: { display: "flex", gap: 8, alignItems: "flex-start" },
			warningIcon: { flex: "none", marginTop: 1, color: "#d97706" }
		};

		function WarningIcon() {
			return h(
				"svg",
				{
					width: 18,
					height: 18,
					viewBox: "0 0 24 24",
					fill: "none",
					"aria-hidden": "true",
					style: styles.warningIcon
				},
				h("path", {
					d: "M12 3.5 21 20.5H3L12 3.5Z",
					stroke: "currentColor",
					strokeWidth: 1.8,
					strokeLinejoin: "round"
				}),
				h("path", {
					d: "M12 9v5",
					stroke: "currentColor",
					strokeWidth: 1.8,
					strokeLinecap: "round"
				}),
				h("path", {
					d: "M12 17h.01",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeLinecap: "round"
				})
			);
		}

		function localize(value) {
			if (typeof value === "string") return value;
			if (value !== null && typeof value === "object") {
				const zhUi = /^zh(?:[-_]|$)/i.test(navigator.language ?? "");
				const picked = zhUi ? (value.zh ?? value.en) : (value.en ?? value.zh);
				return typeof picked === "string" ? picked : "";
			}
			return "";
		}

		function Dialog({ pending, t }) {
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);
			const [selected, setSelected] = useState("reject");
			const rejectRef = useRef(null);
			const allowRef = useRef(null);

			const answer = async (outcome) => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					const response = await fetch("/dsh-approval-popup/answer", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ key: pending.key, outcome })
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
				} catch (cause) {
					setBusy(false);
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			};

			const reason = localize(pending.displayReason) || pending.reason || t("fallbackReason");
			const highRisk = pending.highRisk === true;
			const accent =
				pending.accent !== undefined && typeof pending.accent.hex === "string"
					? { hex: pending.accent.hex, text: pending.accent.text || "#FFFFFF" }
					: { hex: "#1D4ED8", text: "#FFFFFF" };
			const blockKeyboardApproval = (event) => {
				if (
					event.key === "Enter" ||
					event.key === " " ||
					event.key === "Spacebar" ||
					event.key === "ArrowLeft" ||
					event.key === "ArrowRight"
				) {
					event.preventDefault();
					event.stopPropagation();
				}
			};
			const handleKeys = (event) => {
				if (highRisk) {
					blockKeyboardApproval(event);
					return;
				}
				if (event.ctrlKey || event.altKey || event.metaKey) return;
				if (event.key === "Tab") {
					event.preventDefault();
					event.stopPropagation();
					if (highRisk) {
						setSelected("reject");
						rejectRef.current?.focus();
						return;
					}
					const next = event.shiftKey
						? selected === "allow"
							? "reject"
							: "allow"
						: selected === "reject"
							? "allow"
							: "reject";
					setSelected(next);
					(next === "reject" ? rejectRef : allowRef).current?.focus();
					return;
				}
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					event.preventDefault();
					event.stopPropagation();
					const next = event.key === "ArrowLeft" ? "reject" : "allow";
					setSelected(next);
					(next === "reject" ? rejectRef : allowRef).current?.focus();
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					answer(selected === "allow" ? "allowed-once" : "rejected");
				}
			};
			// Capture at the document level so the keys work regardless of which
			// element currently owns focus inside (or just outside) the dialog.
			useEffect(() => {
				document.addEventListener("keydown", handleKeys, true);
				return () => document.removeEventListener("keydown", handleKeys, true);
			}, [highRisk, selected, busy]);
			useEffect(() => {
				const previous = document.body.style.overflow;
				document.body.style.overflow = "hidden";
				rejectRef.current?.focus();
				return () => {
					document.body.style.overflow = previous;
				};
			}, []);
			const metaLabelStyle = highRisk
				? { ...styles.metaLabel, color: "rgba(255, 255, 255, 0.8)" }
				: styles.metaLabel;
			const metaValueStyle = highRisk
				? { ...styles.metaValue, color: "rgba(255, 255, 255, 0.92)" }
				: styles.metaValue;
			const metaStrongStyle = highRisk
				? { ...styles.metaValueStrong, color: "#ffffff" }
				: styles.metaValueStrong;
			const rejectStyle = {
				...styles.button,
				...(highRisk ? styles.buttonHighRiskOutline : styles.buttonOutline),
				...(!highRisk && selected === "reject" ? styles.selectedButton : null),
				...(busy ? styles.buttonDisabled : null)
			};
			const allowStyle = {
				...styles.button,
				...(highRisk
					? styles.buttonHighRiskPrimary
					: { ...styles.buttonPrimary, background: accent.hex, color: accent.text }),
				...(!highRisk && selected === "allow" ? styles.selectedButton : null),
				...(busy ? styles.buttonDisabled : null)
			};
			const footer = h(
				React.Fragment,
				null,
				h(
					"button",
					{
						ref: rejectRef,
						type: "button",
						disabled: busy,
						style: rejectStyle,
						onFocus: () => setSelected("reject"),
						onClick: () => answer("rejected")
					},
					t("reject")
				),
				h(
					"button",
					{
						ref: allowRef,
						type: "button",
						disabled: busy,
						tabIndex: highRisk ? -1 : 0,
						style: allowStyle,
						onFocus: () => setSelected("allow"),
						onKeyDown: highRisk ? blockKeyboardApproval : undefined,
						onClick: () => answer("allowed-once")
					},
					busy ? t("submitting") : t("allow")
				)
			);

			return h(
				"div",
				{ style: styles.overlay, role: "presentation" },
				h(
					"div",
					{
						style: {
							...styles.card,
							...(highRisk ? styles.cardHighRisk : null),
							borderTop: `4px solid ${accent.hex}`
						},
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("title")
					},
					h(
						"div",
						{ style: styles.header },
						h(
							"h2",
							{ style: { ...styles.title, ...(highRisk ? { color: "#ffffff" } : null) } },
							t("title")
						),
						h(
							"p",
							{
								style: {
									...styles.lead,
									...(highRisk ? { color: "rgba(255, 255, 255, 0.9)" } : null)
								}
							},
							t("lead")
						)
					),
					h(
						"div",
						{ style: styles.body },
						highRisk ? h("span", { style: styles.highRiskBadge }, t("highRisk")) : null,
						h(
							"span",
							{
								style: {
									...styles.badge,
									background: accent.hex,
									borderColor: accent.hex,
									color: accent.text
								}
							},
							t("badge")
						),
						h(
							"div",
							{ style: styles.warningRow },
							h(WarningIcon),
							h(
								"div",
								{
									style: {
										...styles.reasonBlock,
										...(highRisk ? styles.reasonBlockHighRisk : null),
										borderLeft: `3px solid ${highRisk ? "#DC2626" : accent.hex}`,
										flex: 1,
										minWidth: 0
									}
								},
								h(
									"div",
									{
										style: {
											...styles.reasonLabel,
											color: highRisk ? "#000000" : "#ffffff"
										}
									},
									t("reason")
								),
								h(
									"div",
									{
										style: {
											...styles.reason,
											color: highRisk ? "#000000" : "#ffffff"
										}
									},
									String(reason)
								)
							)
						),
						h(
							"div",
							{ style: styles.meta },
							h(
								"div",
								{ style: styles.metaRow },
								h("span", { style: metaLabelStyle }, t("conversation")),
								h(
									"span",
									{ style: metaStrongStyle },
									String(pending.title ?? pending.sessionId ?? "")
								)
							),
							h(
								"div",
								{ style: styles.metaRow },
								h("span", { style: metaLabelStyle }, t("workspace")),
								h("span", { style: metaValueStyle }, String(pending.workspace ?? ""))
							),
							h(
								"div",
								{ style: styles.metaRow },
								h("span", { style: metaLabelStyle }, t("tool")),
								h("code", { style: styles.tool }, String(pending.toolName ?? "unknown"))
							)
						),
						error !== null
							? h(
									"div",
									{
										style: highRisk ? { ...styles.error, color: "#ffffff" } : styles.error,
										role: "alert"
									},
									error || t("error")
								)
							: h(
									"div",
									{
										style: highRisk
											? { ...styles.highRiskHint, color: "#ffffff" }
											: styles.hint
									},
									highRisk ? t("highRiskHint") : t("hint")
								)
					),
					h("div", { style: styles.footer }, footer)
				)
			);
		}

		function ApprovalLayer({ t }) {
			const [pending, setPending] = useState(null);

			useEffect(() => {
				let stopped = false;
				let timer;
				let focused = document.hasFocus();
				const onFocus = () => {
					focused = true;
				};
				const onBlur = () => {
					focused = false;
				};
				window.addEventListener("focus", onFocus);
				window.addEventListener("blur", onBlur);
				const tick = async () => {
					try {
						const response = await fetch("/dsh-approval-popup/poll", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								visible: focused && document.visibilityState !== "hidden",
								origin: typeof location !== "undefined" ? location.origin : ""
							})
						});
						const body = await response.json();
						if (!stopped) setPending(body?.pending ?? null);
					} catch {
						// Keep the current modal; the next poll retries.
					}
					if (!stopped) timer = setTimeout(tick, 700);
				};
				tick();
				return () => {
					stopped = true;
					clearTimeout(timer);
					window.removeEventListener("focus", onFocus);
					window.removeEventListener("blur", onBlur);
				};
			}, []);

			if (pending === null) return null;
			return h(Dialog, { key: pending.key, pending, t });
		}

		const SETTINGS_ROWS = [
			["delete", "settings.delete", "settings.deleteDesc"],
			["registry", "settings.registry", "settings.registryDesc"],
			["systemFiles", "settings.systemFiles", "settings.systemFilesDesc"],
			["permissions", "settings.permissions", "settings.permissionsDesc"],
			["disk", "settings.disk", "settings.diskDesc"],
			["dynamic", "settings.dynamic", "settings.dynamicDesc"]
		];

		const ACCENT_OPTIONS = [
			{ id: "deepBlue", hex: "#1D4ED8", labelKey: "settings.color.deepBlue" },
			{ id: "skyBlue", hex: "#0EA5E9", labelKey: "settings.color.skyBlue" },
			{ id: "emerald", hex: "#059669", labelKey: "settings.color.emerald" },
			{ id: "amber", hex: "#D97706", labelKey: "settings.color.amber" }
		];
		const HIGH_RISK_COLOR = { hex: "#DC2626", labelKey: "settings.color.alertRed" };
		const OUTSIDE_OPTIONS = [
			{ id: "off", labelKey: "settings.outside.off", descKey: "settings.outside.offDesc" },
			{
				id: "notification",
				labelKey: "settings.outside.notification",
				descKey: "settings.outside.notificationDesc"
			},
			{
				id: "window",
				labelKey: "settings.outside.window",
				descKey: "settings.outside.windowDesc"
			}
		];

		const settingsStyles = {
			root: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 760 },
			title: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			desc: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
			card: {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 12,
				padding: "2px 14px",
				background: "var(--dsw-alias-bg-layer-1)"
			},
			row: {
				display: "flex",
				alignItems: "flex-start",
				gap: 10,
				padding: "9px 0",
				borderTop: "1px solid var(--dsw-alias-border-l3)"
			},
			checkbox: {
				marginTop: 2,
				width: 16,
				height: 16,
				accentColor: "var(--dsw-alias-brand-primary)",
				flex: "none"
			},
			text: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
			label: { fontSize: 13, color: "var(--dsw-alias-label-primary)" },
			hint: { fontSize: 11, lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)" },
			status: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
			group: {
				margin: "2px 0 10px 10px",
				paddingLeft: 14,
				borderLeft: "2px solid var(--dsw-alias-border-l2)"
			},
			groupDisabled: { opacity: 0.55 },
			groupTitle: {
				fontSize: 11,
				fontWeight: 600,
				letterSpacing: "0.02em",
				color: "var(--dsw-alias-label-tertiary)",
				padding: "4px 0 2px"
			},
			sectionTitle: { margin: "6px 0 0", fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			swatchRow: { display: "flex", flexWrap: "wrap", gap: 8 },
			swatch: {
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 12px",
				borderRadius: 999,
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "transparent",
				color: "var(--dsw-alias-label-primary)",
				font: "inherit",
				fontSize: 12,
				cursor: "pointer"
			},
			swatchSelected: {
				borderColor: "var(--dsw-alias-brand-primary)",
				boxShadow: "0 0 0 2px var(--dsw-alias-brand-primary)"
			},
			swatchDisabled: { cursor: "default", opacity: 0.7 },
			swatchDot: {
				width: 16,
				height: 16,
				borderRadius: 999,
				flex: "none",
				border: "1px solid rgba(0, 0, 0, 0.08)"
			},
			swatchLabel: { fontSize: 12 },
			defaultTag: {
				fontSize: 10,
				color: "var(--dsw-alias-label-tertiary)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 999,
				padding: "1px 6px"
			},
			outsideGrid: { display: "flex", flexDirection: "column", gap: 8 },
			outsideOption: {
				display: "flex",
				alignItems: "flex-start",
				gap: 10,
				padding: "10px 12px",
				borderRadius: 10,
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "transparent",
				color: "var(--dsw-alias-label-primary)",
				textAlign: "left",
				font: "inherit",
				cursor: "pointer"
			},
			outsideOptionSelected: {
				borderColor: "var(--dsw-alias-brand-primary)",
				boxShadow: "0 0 0 2px var(--dsw-alias-brand-primary)"
			},
			outsideText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
			outsideTitle: { fontSize: 13, fontWeight: 600 },
			outsideDesc: {
				fontSize: 11,
				lineHeight: "16px",
				color: "var(--dsw-alias-label-tertiary)"
			},
			warningBox: {
				border: "1px solid rgba(245, 158, 11, 0.55)",
				borderRadius: 12,
				padding: "12px 14px",
				background: "rgba(245, 158, 11, 0.08)",
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			warningTitle: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			warningText: {
				fontSize: 12,
				lineHeight: "18px",
				color: "var(--dsw-alias-label-secondary)"
			},
			warningActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
			warningCancel: {
				padding: "6px 12px",
				borderRadius: 8,
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "transparent",
				color: "var(--dsw-alias-label-primary)",
				font: "inherit",
				cursor: "pointer"
			},
			warningConfirm: {
				padding: "6px 12px",
				borderRadius: 8,
				border: "1px solid #dc2626",
				background: "#dc2626",
				color: "#ffffff",
				font: "inherit",
				cursor: "pointer"
			}
		};

		function ToggleRow({ label, hint, checked, disabled, onChange, first, parent }) {
			return h(
				"label",
				{ style: first ? { ...settingsStyles.row, borderTop: "none" } : settingsStyles.row },
				h("input", {
					type: "checkbox",
					checked,
					disabled,
					style: settingsStyles.checkbox,
					onChange: (event) => onChange(event.currentTarget.checked)
				}),
				h(
					"span",
					{ style: settingsStyles.text },
					h(
						"span",
						{
							style: parent
								? { ...settingsStyles.label, fontWeight: 600 }
								: settingsStyles.label
						},
						label
					),
					hint ? h("span", { style: settingsStyles.hint }, hint) : null
				)
			);
		}

		function SettingsPage({ t }) {
			const [settings, setSettings] = useState(null);
			const [status, setStatus] = useState("");
			const [confirmDisable, setConfirmDisable] = useState(false);

			useEffect(() => {
				let stopped = false;
				fetch("/dsh-approval-popup/settings/get", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				})
					.then((response) => response.json())
					.then((body) => {
						if (stopped) return;
						if (body?.ok === true) setSettings(body.settings);
						else setStatus(t("settings.error"));
					})
					.catch(() => {
						if (!stopped) setStatus(t("settings.error"));
					});
				return () => {
					stopped = true;
				};
			}, []);

			const update = async (key, value) => {
				if (settings === null) return;
				const next = { ...settings, [key]: value };
				setSettings(next);
				setStatus(t("settings.saving"));
				try {
					const response = await fetch("/dsh-approval-popup/settings/set", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ settings: next })
					});
					const body = await response.json();
					if (!response.ok || body?.ok !== true) throw new Error("save failed");
					setSettings(body.settings);
					setStatus(t("settings.saved"));
				} catch {
					setStatus(t("settings.error"));
				}
			};

			if (settings === null) {
				return h("div", { style: settingsStyles.root }, t("settings.loading"));
			}

			return h(
				"div",
				{ style: settingsStyles.root },
				h("h3", { style: settingsStyles.title }, t("settings.title")),
				h("p", { style: settingsStyles.desc }, t("settings.desc")),
				confirmDisable
					? h(
							"div",
							{ style: settingsStyles.warningBox, role: "alertdialog", "aria-modal": "false" },
							h("div", { style: settingsStyles.warningTitle }, t("settings.disableHighRiskTitle")),
							h("div", { style: settingsStyles.warningText }, t("settings.disableHighRiskBody")),
							h(
								"div",
								{ style: settingsStyles.warningActions },
								h(
									"button",
									{
										type: "button",
										style: settingsStyles.warningCancel,
										onClick: () => setConfirmDisable(false)
									},
									t("settings.cancel")
								),
								h(
									"button",
									{
										type: "button",
										style: settingsStyles.warningConfirm,
										onClick: () => {
											setConfirmDisable(false);
											update("enabled", false);
										}
									},
									t("settings.confirmDisable")
								)
							)
						)
					: null,
				h(
					"div",
					{ style: settingsStyles.card },
					h(ToggleRow, {
						first: true,
						parent: true,
						label: t("settings.enabled"),
						hint: t("settings.enabledDesc"),
						checked: settings.enabled,
						onChange: (value) => {
							if (!value) {
								setConfirmDisable(true);
								return;
							}
							update("enabled", value);
						}
					}),
					h(
						"div",
						{
							style: {
								...settingsStyles.group,
								...(settings.enabled ? null : settingsStyles.groupDisabled)
							}
						},
						h("div", { style: settingsStyles.groupTitle }, t("settings.types")),
						SETTINGS_ROWS.map(([key, labelKey, hintKey], index) =>
							h(ToggleRow, {
								key,
								first: index === 0,
								label: t(labelKey),
								hint: t(hintKey),
								checked: settings[key] === true,
								disabled: !settings.enabled,
								onChange: (value) => update(key, value)
							})
						)
					)
				),
				h("h4", { style: settingsStyles.sectionTitle }, t("settings.colors")),
				h(
					"div",
					{ style: settingsStyles.swatchRow },
					ACCENT_OPTIONS.map((option) => {
						const selected = (settings.accent ?? "deepBlue") === option.id;
						return h(
							"button",
							{
								key: option.id,
								type: "button",
								"aria-pressed": selected,
								style: {
									...settingsStyles.swatch,
									...(selected ? settingsStyles.swatchSelected : null)
								},
								onClick: () => update("accent", option.id)
							},
							h("span", { style: { ...settingsStyles.swatchDot, background: option.hex } }),
							h("span", { style: settingsStyles.swatchLabel }, t(option.labelKey))
						);
					})
				),
				h("h4", { style: settingsStyles.sectionTitle }, t("settings.highRiskColor")),
				h(
					"div",
					{ style: settingsStyles.swatchRow },
					h(
						"button",
						{
							type: "button",
							disabled: true,
							"aria-pressed": false,
							style: { ...settingsStyles.swatch, ...settingsStyles.swatchDisabled }
						},
						h("span", {
							style: { ...settingsStyles.swatchDot, background: HIGH_RISK_COLOR.hex }
						}),
						h("span", { style: settingsStyles.swatchLabel }, t(HIGH_RISK_COLOR.labelKey)),
						h("span", { style: settingsStyles.defaultTag }, t("settings.colorDefault"))
					)
				),
				h("p", { style: settingsStyles.hint }, t("settings.colorHint")),
				h("h4", { style: settingsStyles.sectionTitle }, t("settings.outside")),
				h(
					"div",
					{ style: settingsStyles.outsideGrid, role: "radiogroup" },
					OUTSIDE_OPTIONS.map((option) => {
						const selected = (settings.outside ?? "notification") === option.id;
						return h(
							"button",
							{
								key: option.id,
								type: "button",
								role: "radio",
								"aria-checked": selected,
								style: {
									...settingsStyles.outsideOption,
									...(selected ? settingsStyles.outsideOptionSelected : null)
								},
								onClick: () => update("outside", option.id)
							},
							h(
								"span",
								{ style: settingsStyles.outsideText },
								h("span", { style: settingsStyles.outsideTitle }, t(option.labelKey)),
								h("span", { style: settingsStyles.outsideDesc }, t(option.descKey))
							)
						);
					})
				),
				h(
					"div",
					{ style: settingsStyles.status },
					status || (!settings.enabled ? t("settings.off") : "")
				)
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "approval-popup: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{ name: "shell.overlay", id: "approval-popup", order: 1000, locale: NS },
					ApprovalLayer
				)
			);
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "approval-popup",
						order: 2,
						label: () => t("settings.title"),
						locale: NS
					},
					SettingsPage
				)
			);
		}

		exports.name = "dsh-approval-popup";
		exports.inject = ["slots", "locale"];
		exports.apply = apply;
		return module.exports;
	}
});
