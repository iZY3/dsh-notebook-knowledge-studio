/* Notebook Knowledge Studio — client 半(纯 DOM,无构建链)。
 * 在 dsh Web UI 的 settings.section 注册 "Notebook Studio" 全页面板:
 * 三栏布局 Sources / Chat / Studio,通过 /notebook-studio/api 与 host 通信。
 */
window.__ModuleLoader__.load({
	id: "dsh-notebook-knowledge-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const inject = ["slots"];
		const API = "/notebook-studio/api";

		const CSS = `
.nks{--bd:var(--theme-border,#d8dce3);--bg:var(--theme-bg,#fff);--tx:var(--theme-text,#202124);--tx2:var(--theme-text-secondary,#5f6368);--ac:var(--theme-accent,#1a73e8);--panel:var(--theme-input-bg,#f6f8fa);position:relative;display:flex;flex-direction:column;height:100%;min-height:480px;font-size:13px;color:var(--tx)}
.nks *{box-sizing:border-box}
.nks-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
.nks-logo{font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.nks-logo .dot{width:10px;height:10px;border-radius:50%;background:var(--ac)}
.nks select,.nks input[type=text],.nks textarea{background:var(--panel);color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;font-size:13px;outline:none;font-family:inherit}
.nks select:focus,.nks input:focus,.nks textarea:focus{border-color:var(--ac)}
.nks button{background:var(--ac);color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;white-space:nowrap}
.nks button.ghost{background:transparent;border:1px solid var(--bd);color:var(--tx)}
.nks button.danger{background:transparent;border:1px solid #d33;color:#d33}
.nks button:disabled{opacity:.45;cursor:not-allowed}
.nks button.sm{padding:3px 9px;font-size:12px;border-radius:6px}
.nks-body{display:grid;grid-template-columns:minmax(140px,220px) 4px minmax(0,1fr);gap:0;flex:1;min-height:0}
.nks-divider{cursor:col-resize;position:relative;background:transparent;transition:background .15s;outline:none}
.nks-divider::after{content:"";position:absolute;inset:0 -3px}
.nks-divider:hover,.nks-divider.drag,.nks-divider:focus-visible{background:var(--ac);opacity:.4}
.nks.narrow .nks-divider{display:none}
.nks.narrow .nks-body{display:flex;flex-direction:column;overflow:auto}
.nks.narrow .nks-col{border-right:none;border-bottom:1px solid var(--bd);min-height:200px;max-height:320px;flex:0 0 auto}
.nks.narrow .nks-col:last-child{border-bottom:none;flex:1 1 auto;max-height:none;min-height:280px}
.nks-col{border-right:1px solid var(--bd);display:flex;flex-direction:column;min-height:0}
.nks-col:last-child{border-right:none}
.nks-col-h{padding:12px 14px 8px;font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:space-between;color:var(--tx)}
.nks-col-h .sub{font-weight:400;color:var(--tx2);font-size:11px}
.nks-src-list{overflow:auto;flex:1;padding:0 10px 10px}
.nks-src{display:flex;gap:8px;align-items:flex-start;padding:8px 8px;border:1px solid transparent;border-radius:8px;cursor:default}
.nks-src:hover{background:var(--panel);border-color:var(--bd)}
.nks-src .ttl{flex:1;min-width:0}
.nks-src .ttl .t{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nks-src .ttl .m{color:var(--tx2);font-size:11px;display:flex;gap:6px;margin-top:2px;align-items:center}
.nks-badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--panel);border:1px solid var(--bd);color:var(--tx2)}
.nks-badge.pend{color:#b45309;border-color:#f59e0b80}
.nks-chat{flex:1;overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px}
.nks-msg{max-width:92%;border-radius:12px;padding:10px 14px;line-height:1.65;white-space:normal;word-break:break-word}
.nks-msg.user{align-self:flex-end;background:var(--ac);color:#fff}
.nks-msg.ai{align-self:flex-start;background:var(--panel);border:1px solid var(--bd)}
.nks-msg.ai.degraded{border-style:dashed}
.nks-cites{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.nks-cite{font-size:11px;background:var(--bg);border:1px solid var(--bd);border-radius:12px;padding:2px 10px;cursor:pointer;color:var(--ac)}
.nks-cite:hover{border-color:var(--ac)}
.nks-empty{color:var(--tx2);text-align:center;padding:40px 20px;font-size:12px;line-height:2;white-space:pre-line}
.nks-sug{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.nks-sug button{background:var(--panel);color:var(--tx);border:1px solid var(--bd);text-align:left;padding:8px 12px;font-weight:400}
.nks-inputbar{display:flex;gap:8px;padding:12px;border-top:1px solid var(--bd)}
.nks-inputbar input{flex:1}
.nks-studio{flex:1;overflow:auto;padding:0 12px 12px}
.nks-card{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}
.nks-card:hover{border-color:var(--ac)}
.nks-card .t{font-weight:600}
.nks-card .d{color:var(--tx2);font-size:11px;margin-top:2px}
.nks-card.gen{opacity:.6;cursor:wait}
.nks-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:nksr 1s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes nksr{to{transform:rotate(360deg)}}
.nks-art{border:1px solid var(--bd);border-radius:10px;margin-top:10px;background:var(--bg)}
.nks-art .hd{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--bd);font-weight:600}
.nks-art .bd{padding:10px 12px;max-height:340px;overflow:auto}
.nks-md h1,.nks-md h2,.nks-md h3{margin:.6em 0 .3em;font-size:1.05em}
.nks-md p{margin:.4em 0}
.nks-md ul,.nks-md ol{margin:.4em 0;padding-left:1.4em}
.nks-md pre{background:var(--panel);border:1px solid var(--bd);border-radius:8px;padding:10px;overflow:auto;font-size:12px}
.nks-md code{background:var(--panel);border-radius:4px;padding:1px 5px;font-size:12px}
.nks-md pre code{background:none;padding:0}
.nks-md table{border-collapse:collapse;margin:.5em 0;font-size:12px;width:100%}
.nks-md th,.nks-md td{border:1px solid var(--bd);padding:4px 8px;text-align:left}
.nks-md blockquote{border-left:3px solid var(--bd);margin:.5em 0;padding:2px 12px;color:var(--tx2)}
.nks-md a{color:var(--ac)}
.nks-card .fc{perspective:600px;cursor:pointer}
.nks-card .fci{position:relative;transition:transform .35s;transform-style:preserve-3d;min-height:90px}
.nks-card .fc.flip .fci{transform:rotateY(180deg)}
.nks-card .fcf,.nks-card .fcb{backface-visibility:hidden;padding:10px;border-radius:8px}
.nks-card .fcb{position:absolute;inset:0;transform:rotateY(180deg);background:var(--panel);border:1px solid var(--bd)}
.nks-modal{position:absolute;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:60}
.nks-modal .box{background:var(--bg);border:1px solid var(--bd);border-radius:14px;width:min(680px,92vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,.18)}
.nks-modal .hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--bd);font-weight:700}
.nks-modal .bd{padding:16px 18px;overflow:auto}
.nks-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.nks-tabs button{background:var(--panel);color:var(--tx);border:1px solid var(--bd);font-weight:500}
.nks-tabs button.on{background:var(--ac);color:#fff;border-color:var(--ac)}
.nks-row{display:flex;gap:8px;margin-bottom:10px;align-items:center}
.nks-row input,.nks-row textarea{flex:1}
.nks-row textarea{min-height:120px;resize:vertical}
.nks-cand{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.nks-cand .row{display:flex;gap:9px;align-items:flex-start}
.nks-cand .row input[type=checkbox]{margin-top:3px;flex:none}
.nks-cand .main{flex:1;min-width:0}
.nks-cand .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nks-cand .u{color:var(--tx2);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.nks-cand .s{color:var(--tx2);font-size:12px;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nks-cand .date{font-size:10px;color:var(--tx2);background:var(--panel);border:1px solid var(--bd);border-radius:8px;padding:1px 6px;margin-left:6px;flex:none}
.nks-cand .trow{display:flex;align-items:center;gap:4px;min-width:0}
.nks-cand .trow .t{flex:1;min-width:0}
.nks-cand .pv{flex:none;margin-top:1px}
.nks-drawer{position:absolute;right:0;top:0;bottom:0;width:min(520px,90%);background:var(--bg);border-left:1px solid var(--bd);z-index:70;display:flex;flex-direction:column;box-shadow:-12px 0 32px rgba(0,0,0,.12)}
.nks-drawer .hd{padding:12px 16px;border-bottom:1px solid var(--bd)}
.nks-drawer .bd{flex:1;overflow:auto;padding:14px 16px;white-space:pre-wrap;line-height:1.7;font-size:12.5px}
.nks-drawer mark{background:#fde047;color:inherit;border-radius:3px}
.nks-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#202124;color:#fff;border-radius:10px;padding:9px 18px;font-size:12.5px;z-index:90;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.nks-quiz-q{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin-bottom:10px}
.nks-quiz-q .opt{display:block;padding:5px 9px;border:1px solid var(--bd);border-radius:8px;margin:4px 0;cursor:pointer}
.nks-quiz-q .opt:hover{border-color:var(--ac)}
.nks-quiz-q .opt.ok{border-color:#16a34a;background:#16a34a1a}
.nks-quiz-q .opt.no{border-color:#d33;background:#d331a}
.nks-hint{color:var(--tx2);font-size:11px;padding:6px 2px}
`;

		function el(tag, cls, text) {
			const e = document.createElement(tag);
			if (cls) e.className = cls;
			if (text !== undefined && text !== null) e.textContent = String(text);
			return e;
		}

		async function api(method, path, body) {
			const res = await fetch(API + path, {
				method,
				headers: { "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
			return data;
		}

		function esc(s) {
			return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
		}

		function mdToHtml(md) {
			const lines = String(md ?? "").split(/\r?\n/);
			let html = "";
			let inCode = false, codeBuf = [], listType = null, tableBuf = [];
			const flushList = () => { if (listType) { html += listType === "ul" ? "</ul>" : "</ol>"; listType = null; } };
			const flushTable = () => {
				if (!tableBuf.length) return;
				const rows = tableBuf.filter(r => !/^\|[\s:|-]+\|$/.test(r.trim()));
				html += "<table>" + rows.map((r, i) => {
					const cells = r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
					return `<tr>${cells.map(c => `<${i === 0 ? "th" : "td"}>${c}</${i === 0 ? "th" : "td"}>`).join("")}</tr>`;
				}).join("") + "</table>";
				tableBuf = [];
			};
			const inline = (s) => esc(s)
				.replace(/`([^`]+)`/g, "<code>$1</code>")
				.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
				.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<i>$2</i>")
				.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
			for (const line of lines) {
				if (/^```/.test(line.trim())) {
					if (inCode) { html += `<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`; codeBuf = []; }
					else { flushList(); flushTable(); }
					inCode = !inCode;
					continue;
				}
				if (inCode) { codeBuf.push(line); continue; }
				if (/^\|.*\|/.test(line.trim())) { flushList(); tableBuf.push(line); continue; }
				flushTable();
				const h = line.match(/^(#{1,4})\s+(.*)$/);
				if (h) { flushList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
				if (/^\s*[-*]\s+/.test(line)) { if (listType !== "ul") { flushList(); html += "<ul>"; listType = "ul"; } html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`; continue; }
				if (/^\s*\d+[.)]\s+/.test(line)) { if (listType !== "ol") { flushList(); html += "<ol>"; listType = "ol"; } html += `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`; continue; }
				if (/^>\s?/.test(line)) { flushList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`; continue; }
				if (/^(---|\*\*\*)$/.test(line.trim())) { flushList(); html += "<hr>"; continue; }
				if (!line.trim()) { flushList(); continue; }
				flushList();
				html += `<p>${inline(line)}</p>`;
			}
			if (inCode) html += `<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`;
			flushList(); flushTable();
			return html;
		}

		function toast(msg, isErr) {
			const t = el("div", "nks-toast", msg);
			if (isErr) t.style.background = "#b91c1c";
			document.body.appendChild(t);
			setTimeout(() => t.remove(), isErr ? 5000 : 2600);
		}

		/** 面板内表单模态(替代原生 prompt,避免被对话框拦截器吞掉)。 */
		function openForm(root, { title, fields, submitText, onSubmit }) {
			const overlay = el("div", "nks-modal");
			const box = el("div", "box");
			const hd = el("div", "hd");
			hd.appendChild(el("span", undefined, title));
			const btnX = el("button", "ghost sm", "✕");
			btnX.onclick = () => overlay.remove();
			hd.appendChild(btnX);
			const bd = el("div", "bd");
			const inputs = {};
			for (const f of fields) {
				bd.appendChild(el("div", "nks-hint", f.label));
				let ctl;
				if (f.type === "select") {
					ctl = el("select");
					for (const [v, label] of f.options) { const o = el("option", undefined, label); o.value = v; ctl.appendChild(o); }
				} else if (f.type === "textarea") {
					ctl = el("textarea");
				} else {
					ctl = el("input"); ctl.type = "text";
				}
				if (f.value) ctl.value = f.value;
				inputs[f.key] = ctl;
				bd.appendChild(ctl);
			}
			const bar = el("div", "nks-row");
			const btnCancel = el("button", "ghost", "取消");
			btnCancel.onclick = () => overlay.remove();
			const btnOk = el("button", undefined, submitText || "确定");
			bar.append(btnCancel, btnOk);
			bd.appendChild(bar);
			btnOk.onclick = () => {
				const values = {};
				for (const f of fields) values[f.key] = inputs[f.key].value;
				overlay.remove();
				onSubmit(values);
			};
			box.append(hd, bd);
			overlay.appendChild(box);
			overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
			root.appendChild(overlay);
		}

		/** 面板内确认模态(替代原生 confirm)。 */
		function openConfirm(root, message, onOk) {
			const overlay = el("div", "nks-modal");
			const box = el("div", "box");
			box.style.maxWidth = "440px";
			const bd = el("div", "bd");
			bd.appendChild(el("div", undefined, message));
			const bar = el("div", "nks-row");
			const btnNo = el("button", "ghost", "取消");
			btnNo.onclick = () => overlay.remove();
			const btnYes = el("button", "danger", "确认删除");
			btnYes.onclick = () => { overlay.remove(); onOk(); };
			bar.append(btnNo, btnYes);
			bd.appendChild(bar);
			box.appendChild(bd);
			overlay.appendChild(box);
			overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
			root.appendChild(overlay);
		}

		function apply(ctx) {
			// 主界面视图:conversation.view 是主区域可切换视图列表("chat" 为默认标签)。
			// 注册后顶栏出现 "Notebook Studio" 标签,面板占据整个会话主区域。
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "notebook-knowledge-studio",
				order: 10,
				label: () => "Notebook Studio",
			}, SectionHost)), "notebook-studio: main view");
		}

		/** React 宿主:挂载命令式 DOM,卸载时清理。主区域高度确定,直接 100%。 */
		function SectionHost(_props) {
			const ref = React.useRef(null);
			React.useEffect(() => renderApp(ref.current), []);
			return React.createElement("div", { ref: ref, style: { height: "100%", minHeight: "460px" } });
		}

		const state = {
			notebooks: [],
			currentId: null,
			detail: null,
			selected: new Set(),
			messages: [],
			artifacts: [],
		};

		const STUDIO_CARDS = [
			["mindmap", "Mind Map", "思维导图 · 3-5 主分支"],
			["report", "Reports", "简报/学习指南/FAQ/时间线"],
			["flashcards", "Flashcards", "学习闪卡 · 20-50 张"],
			["quiz", "Quiz", "测验 · 10-20 题"],
			["infographic", "Infographic", "信息图 · Mermaid 结构"],
			["slides", "Slide Deck", "演示文稿 · ≤12 页"],
			["table", "Data Table", "数据表格 · MD+CSV"],
		];

		function renderApp(container) {
			const style = el("style");
			style.textContent = CSS;
			document.head.appendChild(style);

			const root = el("div", "nks");

			// ── 顶栏 ──
			const top = el("div", "nks-top");
			const logo = el("div", "nks-logo");
			logo.appendChild(el("span", "dot"));
			logo.appendChild(el("span", undefined, "Notebook Knowledge Studio"));
			const sel = el("select");
			sel.appendChild(el("option", undefined, "— 选择 Notebook —"));
			const btnNew = el("button", undefined, "＋ 新建");
			const btnDel = el("button", "danger", "删除");
			btnDel.style.display = "none";
			const activeInfo = el("span", "nks-hint", "");
			activeInfo.style.marginLeft = "auto";
			const btnActivate = el("button", "ghost", "设为对话上下文");
			btnActivate.style.display = "none";
			btnActivate.title = "激活后,在左侧主对话直接提问即走本 Notebook 的检索问答(nb_query 带引用)";
			top.append(logo, sel, btnNew, btnDel, activeInfo, btnActivate);

			// ── 三栏 ──
			const body = el("div", "nks-body");

			// 左:Sources
			const colL = el("div", "nks-col");
			const lh = el("div", "nks-col-h");
			const lhLeft = el("div");
			const lhTitle = el("span", undefined, "Sources");
			const lhSub = el("span", "sub");
			lhLeft.append(lhTitle, lhSub);
			const btnAdd = el("button", "sm", "Add");
			lh.append(lhLeft, btnAdd);
			const srcList = el("div", "nks-src-list");
			colL.append(lh, srcList);

			// 中:Chat 已合并到主对话(系统提示注入 + agent 调 nb_query),面板不再单设对话列

			// 右:Studio
			const colR = el("div", "nks-col");
			const rh = el("div", "nks-col-h");
			rh.append(el("span", undefined, "Studio"));
			const rhSub = el("span", "sub", "基于选中 Sources");
			rh.append(rhSub);
			const studio = el("div", "nks-studio");
			colR.append(rh, studio);

			// ── 列宽拖拽(左右栏可调,中间自适应;宽度持久化到 localStorage)──
			const colW = { left: 220 }
			try {
				const saved = JSON.parse(localStorage.getItem("nks.colWidths") ?? "null")
				if (saved && Number(saved.left) >= 120) {
					colW.left = Number(saved.left)
				}
			} catch { /* 无 localStorage 则用默认 */ }

			const applyCols = () => {
				const total = root.clientWidth || 900
				const max = Math.max(160, Math.floor(total * 0.45))
				colW.left = Math.min(max, Math.max(120, colW.left))
				body.style.gridTemplateColumns = `${colW.left}px 4px minmax(0,1fr)`
			}

			const mkDivider = (side) => {
				const d = el("div", "nks-divider")
				d.tabIndex = 0
				d.setAttribute("role", "separator")
				d.setAttribute("aria-label", side === "left" ? "调整 Sources 栏宽" : "调整 Studio 栏宽")
				d.addEventListener("keydown", (ev) => {
					const step = ev.shiftKey ? 60 : 20
					if (ev.key === "ArrowLeft") {
						colW[side] -= step
					} else if (ev.key === "ArrowRight") {
						colW[side] += step
					} else return
					ev.preventDefault()
					applyCols()
					try { localStorage.setItem("nks.colWidths", JSON.stringify(colW)) } catch { /* 忽略 */ }
				})
				d.addEventListener("mousedown", (ev) => {
					if (ev.button !== 0) return
					ev.preventDefault()
					d.classList.add("drag")
					const startX = ev.clientX
					const startW = side === "left" ? colW.left : colW.right
					const move = (e2) => {
						const dx = e2.clientX - startX
						if (side === "left") colW.left = startW + dx
						else colW.right = startW - dx
						applyCols()
					}
					const up = () => {
						d.classList.remove("drag")
						document.removeEventListener("mousemove", move)
						document.removeEventListener("mouseup", up)
						try { localStorage.setItem("nks.colWidths", JSON.stringify(colW)) } catch { /* 忽略 */ }
					}
					document.addEventListener("mousemove", move)
					document.addEventListener("mouseup", up)
				})
				return d
			}

			const divL = mkDivider("left")
			body.append(colL, divL, colR)
			root.append(top, body)

			// ── 行为 ──

			async function refreshNotebooks(keepCurrent) {
				try {
					const data = await api("GET", "/notebooks");
					state.notebooks = data.notebooks || [];
					sel.innerHTML = "";
					sel.appendChild(el("option", undefined, "— 选择 Notebook —"));
					for (const nb of state.notebooks) {
						const o = el("option", undefined, `${nb.title}(${nb.sourceCount} 源)`);
						o.value = nb.id;
						sel.appendChild(o);
					}
					if (state.currentId && state.notebooks.some(n => n.id === state.currentId) && keepCurrent !== false) {
						sel.value = state.currentId;
					} else if (state.notebooks.length) {
						state.currentId = state.notebooks[0].id;
						sel.value = state.currentId;
					} else {
						state.currentId = null;
					}
					btnDel.style.display = state.currentId ? "" : "none";
					btnActivate.style.display = state.currentId ? "" : "none";
					await refreshActive();
					await loadDetail();
				} catch (e) { toast("加载 Notebook 列表失败: " + e.message, true); }
			}

			async function refreshActive() {
				try {
					const s = await api("GET", "/status");
					state.activeId = s.activeNotebook?.id ?? null;
				} catch { state.activeId = null; }
				activeInfo.textContent = state.activeId
					? `对话上下文:${state.activeId}${state.activeId === state.currentId ? "(当前)" : ""}`
					: "未激活对话上下文";
			}

			btnActivate.onclick = async () => {
				if (!state.currentId) return;
				try {
					const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/activate`);
					await refreshActive();
					toast(`已激活「${r.active.title}」— 现在直接在左侧对话提问即可`);
				} catch (e) { toast("激活失败: " + e.message, true); }
			};

			async function loadDetail() {
				if (!state.currentId) {
					state.detail = null; state.selected = new Set(); state.artifacts = [];
					renderSources(); renderStudio();
					return;
				}
				try {
					state.detail = await api("GET", `/notebooks/${encodeURIComponent(state.currentId)}`);
					const sources = state.detail.sources || [];
					const valid = new Set(sources.map(s => s.id));
					state.selected = new Set([...state.selected].filter(id => valid.has(id)));
					if (!state.selected.size && sources.length) sources.forEach(s => { if (s.status !== "multimodal-pending") state.selected.add(s.id); });
					state.artifacts = state.detail.artifacts || [];
					lhSub.textContent = `${sources.length} 个 · 选中 ${state.selected.size}`;
					renderSources(); renderStudio();
				} catch (e) { toast("加载 Notebook 失败: " + e.message, true); }
			}

			function renderSources() {
				srcList.innerHTML = "";
				if (!state.detail) { srcList.appendChild(el("div", "nks-empty", "选择或新建一个 Notebook\n然后添加 Sources")); return; }
				const sources = state.detail.sources || [];
				if (!sources.length) { srcList.appendChild(el("div", "nks-empty", "还没有来源。\n点上方 Add 导入文件 / 网址 / 文本 / 网页搜索。")); return; }
				const allRow = el("div", "nks-src");
				const allCb = el("input"); allCb.type = "checkbox";
				allCb.checked = sources.filter(s => s.status !== "multimodal-pending").every(s => state.selected.has(s.id));
				allCb.onchange = () => {
					state.selected = new Set();
					if (allCb.checked) sources.forEach(s => { if (s.status !== "multimodal-pending") state.selected.add(s.id); });
					loadDetail();
				};
				const allT = el("div", "ttl");
				allT.appendChild(el("div", "t", "Select all"));
				allRow.append(allCb, allT);
				srcList.appendChild(allRow);
				for (const s of sources) {
					const row = el("div", "nks-src");
					const cb = el("input"); cb.type = "checkbox";
					cb.checked = state.selected.has(s.id);
					cb.disabled = s.status === "multimodal-pending";
					cb.onchange = () => { if (cb.checked) state.selected.add(s.id); else state.selected.delete(s.id); loadDetail(); };
					const ttl = el("div", "ttl");
					ttl.appendChild(el("div", "t", s.title));
					const m = el("div", "m");
					const badge = el("span", "nks-badge" + (s.status === "multimodal-pending" ? " pend" : ""), s.status === "multimodal-pending" ? "待转写" : s.type);
					m.appendChild(badge);
					m.appendChild(el("span", undefined, `${s.words} 词`));
					const btnView = el("button", "sm ghost", "查看");
					btnView.onclick = (ev) => { ev.stopPropagation(); openSourceDrawer(s); };
					const btnRef = el("button", "sm ghost", "↻");
					btnRef.title = "Refresh";
					btnRef.onclick = async (ev) => {
						ev.stopPropagation();
						btnRef.disabled = true;
						try { const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/sources/${encodeURIComponent(s.id)}/refresh`); toast(r.status === "unchanged" ? "内容无变化" : `已刷新: ${r.title ?? r.status}`); await loadDetail(); }
						catch (e) { toast("刷新失败: " + e.message, true); }
						btnRef.disabled = false;
					};
					const btnRm = el("button", "sm danger", "✕");
					btnRm.title = "移除";
					btnRm.onclick = async (ev) => {
						ev.stopPropagation();
						openConfirm(root, `移除来源「${s.title}」?不影响其他来源。`, async () => {
							try { await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/sources/${encodeURIComponent(s.id)}/remove`); await loadDetail(); toast("已移除"); }
							catch (e) { toast("移除失败: " + e.message, true); }
						})
					};
					m.append(btnView, btnRef, btnRm);
					ttl.appendChild(m);
					row.append(cb, ttl);
					srcList.appendChild(row);
				}
			}

			function renderStudio() {
				studio.innerHTML = "";
				if (!state.detail) { studio.appendChild(el("div", "nks-empty", "Studio 卡片将在此出现")); return; }
				for (const [kind, name, desc] of STUDIO_CARDS) {
					const card = el("div", "nks-card");
					card.dataset.kind = kind;
					card.appendChild(el("div", "t", name));
					card.appendChild(el("div", "d", desc));
					card.onclick = () => generate(kind, name, card);
					studio.appendChild(card);
				}
				if (state.artifacts.length) {
					const hd = el("div", "nks-hint", "最近产物:");
					studio.appendChild(hd);
					for (const a of state.artifacts.slice(0, 6)) {
						const item = el("div", "nks-card");
						item.appendChild(el("div", "t", a.title));
						item.appendChild(el("div", "d", `${a.kind} · ${a.file}`));
						item.onclick = async () => {
							try {
								const r = await api("GET", `/notebooks/${encodeURIComponent(state.currentId)}/artifact?file=${encodeURIComponent(a.file)}`);
								openArtifactPreview(a, r.content);
							} catch (e) { toast("读取产物失败: " + e.message, true); }
						};
						studio.appendChild(item);
					}
				}
			}

			function generate(kind, name, card) {
				if (card.classList.contains("gen")) return;
				const fields = [
					{ key: "topic", label: `主题(留空 = 整个知识库综述)`, type: "text" },
				]
				if (kind === "report") {
					fields.push({
						key: "reportType", label: "报告类型", type: "select",
						options: [["briefing", "Briefing 简报"], ["study-guide", "Study Guide 学习指南"], ["faq", "FAQ 常见问题"], ["timeline", "Timeline 时间线"], ["research", "Research Report"], ["custom", "Custom 自定义"]],
					})
				}
				fields.push({ key: "instruction", label: "附加要求(可留空)", type: "text" })
				openForm(root, {
					title: `生成 ${name}`,
					fields,
					submitText: "生成",
					onSubmit: async (v) => {
						card.classList.add("gen")
						const t = card.querySelector(".t")
						const orig = t.textContent
						t.innerHTML = `<span class="nks-spin"></span>生成中…`
						try {
							const result = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/studio`, {
								kind, topic: v.topic || undefined, instruction: v.instruction || undefined,
								reportType: v.reportType || "briefing", sourceIds: [...state.selected],
							})
							toast(`已生成: ${result.title}`)
							await loadDetail()
							const r = await api("GET", `/notebooks/${encodeURIComponent(state.currentId)}/artifact?file=${encodeURIComponent(result.file)}`)
							openArtifactPreview(result, r.content)
						} catch (e) { toast(`生成失败: ${e.message}`, true) }
						card.classList.remove("gen")
						t.textContent = orig
					},
				})
			}

			function openArtifactPreview(meta, contentRaw) {
				root.querySelectorAll(".nks-modal").forEach(m => m.remove());
				const overlay = el("div", "nks-modal");
				const box = el("div", "box");
				const hd = el("div", "hd");
				hd.appendChild(el("span", undefined, meta.title ?? "产物预览"));
				const btnClose = el("button", "ghost", "关闭");
				btnClose.onclick = closeModal;
				hd.appendChild(btnClose);
				const bd = el("div", "bd");
				const parsed = parseOkfLite(contentRaw);
				const kind = meta.kind;
				if (kind === "flashcards") renderFlashcards(bd, parsed.body);
				else if (kind === "quiz") renderQuiz(bd, parsed.body);
				else if (kind === "table") {
					const md = el("div", "nks-md");
					const csvNote = meta.csv ? `<p class="nks-hint">CSV: ${esc(meta.csv)}</p>` : "";
					md.innerHTML = mdToHtml(parsed.body) + csvNote;
					bd.appendChild(md);
				} else {
					const md = el("div", "nks-md");
					let html = mdToHtml(parsed.body);
					// mermaid 块增强:尝试渲染,失败则保留源码
					bd.appendChild(md);
					md.innerHTML = html;
					enhanceMermaid(md);
				}
				bd.appendChild(el("div", "nks-hint", `文件: ${meta.file ?? ""}`));
				box.append(hd, bd);
				overlay.appendChild(box);
				overlay.onclick = (ev) => { if (ev.target === overlay) closeModal(); };
				root.appendChild(overlay);
				function closeModal() { overlay.remove(); }
			}

			function parseOkfLite(text) {
				const s = String(text ?? "");
				if (!s.startsWith("---")) return { frontmatter: {}, body: s };
				const end = s.indexOf("\n---", 3);
				if (end < 0) return { frontmatter: {}, body: s };
				return { frontmatter: {}, body: s.slice(end + 4).replace(/^\s*\n/, "") };
			}

			function enhanceMermaid(container) {
				const pres = container.querySelectorAll("pre code");
				pres.forEach(pre => {
					const src = pre.textContent ?? "";
					if (!/^\s*(mindmap|graph|flowchart|sequenceDiagram|gantt)\b/m.test(src)) return;
					const wrap = el("div", "nks-hint", "▲ Mermaid 图(源码;Obsidian 可直接渲染)");
					pre.parentNode.after(wrap);
				});
			}

			function renderFlashcards(bd, bodyText) {
				const m = bodyText.match(/```json\s*([\s\S]*?)```/);
				let cards = [];
				if (m) { try { cards = JSON.parse(m[1]); } catch { } }
				if (!cards.length) { const md = el("div", "nks-md"); md.innerHTML = mdToHtml(bodyText); bd.appendChild(md); return; }
				let i = 0;
				const wrap = el("div");
				const counter = el("div", "nks-hint");
				const fc = el("div", "nks-card fc");
				const inner = el("div", "fci");
				const front = el("div", "fcf");
				const back = el("div", "fcb");
				inner.append(front, back);
				fc.appendChild(inner);
				const btnPrev = el("button", "sm ghost", "‹ 上一张");
				const btnNext = el("button", "sm", "下一张 ›");
				const btnFlipHint = el("span", "nks-hint", "点击卡片翻面");
				const controls = el("div", "nks-row");
				controls.append(btnPrev, btnFlipHint, btnNext);
				const show = () => {
					const c = cards[i];
					fc.classList.remove("flip");
					setTimeout(() => {
						front.innerHTML = `<b>${esc(c.front)}</b><div class="nks-hint">${esc(c.difficulty ?? "")} · 来源: ${esc(c.source ?? "")}</div>`;
						back.innerHTML = `<div>${esc(c.back)}</div><div class="nks-hint">${esc(c.explanation ?? "")}</div>`;
					}, fc.classList.contains("flip") ? 180 : 0);
					counter.textContent = `${i + 1} / ${cards.length}`;
				};
				fc.onclick = () => fc.classList.toggle("flip");
				btnPrev.onclick = () => { i = (i - 1 + cards.length) % cards.length; show(); };
				btnNext.onclick = () => { i = (i + 1) % cards.length; show(); };
				wrap.append(counter, fc, controls);
				bd.appendChild(wrap);
				show();
			}

			function renderQuiz(bd, bodyText) {
				const m = bodyText.match(/```json\s*([\s\S]*?)```/);
				let quiz = [];
				if (m) { try { quiz = JSON.parse(m[1]); } catch { } }
				if (!quiz.length) { const md = el("div", "nks-md"); md.innerHTML = mdToHtml(bodyText); bd.appendChild(md); return; }
				quiz.forEach((q, qi) => {
					const box = el("div", "nks-quiz-q");
					box.appendChild(el("div", "t", `${qi + 1}. ${q.question}`));
					const chosen = { v: null };
					if (Array.isArray(q.options) && q.options.length) {
						q.options.forEach((opt, oi) => {
							const o = el("div", "opt", `${"ABCD"[oi]}) ${opt}`);
							o.onclick = () => {
								if (chosen.v !== null) return;
								chosen.v = oi;
								const isOk = String(opt).trim() === String(q.answer).trim() || `${"ABCD"[oi]}` === String(q.answer).trim().charAt(0);
								o.classList.add(isOk ? "ok" : "no");
								const ans = el("div", "nks-hint", `答案:${q.answer} — ${q.explanation ?? ""}`);
								box.appendChild(ans);
							};
							box.appendChild(o);
						});
					} else {
						const btn = el("button", "sm ghost", "显示答案");
						btn.onclick = () => {
							const ans = el("div", "nks-hint", `答案:${q.answer} — ${q.explanation ?? ""}`);
							box.appendChild(ans);
							btn.remove();
						};
						box.appendChild(btn);
					}
					bd.appendChild(box);
				});
			}

			/** 搜索候选的网页正文预览抽屉(不导入)。 */
			function openUrlPreview(p) {
				root.querySelectorAll(".nks-drawer").forEach(d => d.remove());
				const drawer = el("div", "nks-drawer");
				const hd = el("div", "hd");
				const tRow = el("div", "nks-row");
				const tEl = el("b", undefined, p.title || "预览");
				const btnClose = el("button", "sm ghost", "关闭");
				btnClose.onclick = () => drawer.remove();
				tRow.append(tEl, btnClose);
				const meta = el("div", "nks-hint");
				meta.textContent = [p.url, p.author, p.publishedAt, `正文约 ${p.chars} 字符`, p.httpStatus && p.httpStatus >= 400 ? `HTTP ${p.httpStatus}` : null].filter(Boolean).join(" · ");
				hd.append(tRow, meta);
				const bd = el("div", "bd", p.excerpt || p.note || "(正文为空)");
				bd.style.color = p.excerpt ? "" : "var(--tx2)";
				drawer.append(hd, bd);
				root.appendChild(drawer);
			}

			function openSourceDrawer(source, quote) {
				document.querySelectorAll(".nks-drawer").forEach(d => d.remove());
				const drawer = el("div", "nks-drawer");
				const hd = el("div", "hd");
				const tRow = el("div", "nks-row");
				const tEl = el("b", undefined, source.title ?? source.id);
				const btnClose = el("button", "sm ghost", "关闭");
				btnClose.onclick = () => drawer.remove();
				tRow.append(tEl, btnClose);
				hd.appendChild(tRow);
				const bd = el("div", "bd", "加载中…");
				drawer.append(hd, bd);
				root.appendChild(drawer);
				api("GET", `/notebooks/${encodeURIComponent(state.currentId)}/sources/${encodeURIComponent(source.id)}`)
					.then(doc => {
						bd.textContent = "";
						const fm = doc.frontmatter || {};
						const meta = el("div", "nks-hint");
						meta.textContent = [fm.resource, fm.published_at, fm.status].filter(Boolean).join(" · ");
						bd.appendChild(meta);
						const content = el("div");
						content.textContent = doc.body ?? "";
						bd.appendChild(content);
						if (quote) {
							const hay = (doc.body ?? "");
							const pos = hay.indexOf(quote.slice(0, 60));
							if (pos >= 0) {
								const marked = esc(hay.slice(0, pos)) + "<mark>" + esc(hay.slice(pos, pos + quote.length + 40)) + "</mark>" + esc(hay.slice(pos + quote.length + 40));
								content.innerHTML = marked;
								const mark = content.querySelector("mark");
								if (mark) mark.scrollIntoView({ block: "center" });
							}
						}
					})
					.catch(e => { bd.textContent = "加载失败: " + e.message; });
			}

			function openAddModal() {
				if (!state.currentId) { toast("先选择或新建一个 Notebook", true); return; }
				const overlay = el("div", "nks-modal");
				const box = el("div", "box");
				const hd = el("div", "hd");
				hd.appendChild(el("span", undefined, "Add sources"));
				const btnX = el("button", "ghost sm", "✕");
				btnX.onclick = () => overlay.remove();
				hd.appendChild(btnX);
				const bd = el("div", "bd");
				const tabs = el("div", "nks-tabs");
				const tabNames = ["本地文件", "网址", "粘贴文本", "网页搜索"];
				const panes = {};
				let active = 0;
				tabNames.forEach((name, i) => {
					const b = el("button", i === 0 ? "on" : undefined, name);
					b.onclick = () => {
						active = i;
						tabs.querySelectorAll("button").forEach((x, j) => x.className = j === i ? "on" : undefined);
						Object.entries(panes).forEach(([k, p]) => p.style.display = Number(k) === i ? "" : "none");
					};
					tabs.appendChild(b);
				});
				const paneFile = el("div"); panes[0] = paneFile;
				const paneUrl = el("div"); panes[1] = paneUrl; paneUrl.style.display = "none";
				const paneText = el("div"); panes[2] = paneText; paneText.style.display = "none";
				const paneSearch = el("div"); panes[3] = paneSearch; paneSearch.style.display = "none";

				// 本地文件
				const fRow = el("div", "nks-row");
				const fPath = el("input"); fPath.type = "text"; fPath.placeholder = "本地文件绝对路径,如 E:\\docs\\paper.md(多模态文件自动走 Qwen-MM 转写)";
				const fBtn = el("button", undefined, "导入");
				fRow.append(fPath, fBtn);
				fBtn.onclick = async () => {
					if (!fPath.value.trim()) return toast("请输入文件路径", true);
					fBtn.disabled = true; fBtn.textContent = "导入中…";
					try {
						const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/sources`, { type: "file", path: fPath.value.trim() });
						handleSourceResult(r); fPath.value = "";
					} catch (e) { toast("导入失败: " + e.message, true); }
					fBtn.disabled = false; fBtn.textContent = "导入";
				};
				paneFile.appendChild(fRow);

				// 网址
				const uRow = el("div", "nks-row");
				const uInput = el("input"); uInput.type = "text"; uInput.placeholder = "https://…(抓取全文并提取正文)";
				const uBtn = el("button", undefined, "导入");
				uRow.append(uInput, uBtn);
				uBtn.onclick = async () => {
					if (!uInput.value.trim()) return toast("请输入网址", true);
					uBtn.disabled = true; uBtn.textContent = "抓取中…";
					try {
						const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/sources`, { type: "url", url: uInput.value.trim() });
						handleSourceResult(r); uInput.value = "";
					} catch (e) { toast("导入失败: " + e.message, true); }
					uBtn.disabled = false; uBtn.textContent = "导入";
				};
				paneUrl.appendChild(uRow);

				// 粘贴文本
				const tTitle = el("div", "nks-row");
				const tInput = el("input"); tInput.type = "text"; tInput.placeholder = "标题(可选)";
				tTitle.appendChild(tInput);
				const tArea = el("textarea"); tArea.placeholder = "粘贴正文…";
				const tBtn = el("button", undefined, "保存为 Source");
				tBtn.style.marginTop = "8px";
				tBtn.onclick = async () => {
					if (!tArea.value.trim()) return toast("请输入正文", true);
					tBtn.disabled = true;
					try {
						const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/sources`, { type: "text", text: tArea.value, title: tInput.value || undefined });
						handleSourceResult(r); tArea.value = ""; tInput.value = "";
					} catch (e) { toast("保存失败: " + e.message, true); }
					tBtn.disabled = false;
				};
				paneText.append(tTitle, tArea, tBtn);

				// 网页搜索
				const sRow = el("div", "nks-row");
				const sInput = el("input"); sInput.type = "text"; sInput.placeholder = "Search the web for sources — 关键词 / 主题 / 研究问题";
				const sBtn = el("button", undefined, "搜索");
				sRow.append(sInput, sBtn);
				const sResults = el("div");
				paneSearch.append(sRow, sResults);
				let candidates = [];
				sBtn.onclick = async () => {
					if (!sInput.value.trim()) return;
					sBtn.disabled = true; sBtn.textContent = "搜索中…";
					sResults.innerHTML = `<div class="nks-hint"><span class="nks-spin"></span>搜索中…</div>`;
					try {
						const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/discover`, { query: sInput.value.trim() });
						candidates = (r.candidates || []).map(c => ({ ...c, checked: false }));
						renderCandidates();
					} catch (e) {
						sResults.innerHTML = "";
						sResults.appendChild(el("div", "nks-hint", "搜索失败: " + e.message + "(检查 dsh web 搜索 provider 配置)"));
					}
					sBtn.disabled = false; sBtn.textContent = "搜索";
				};
				function renderCandidates() {
					sResults.innerHTML = "";
					if (!candidates.length) { sResults.appendChild(el("div", "nks-hint", "无结果")); return; }
					const bar = el("div", "nks-row");
					const btnAll = el("button", "sm ghost", "全选");
					const btnImp = el("button", undefined, `Import 选中(0)`);
					btnAll.onclick = () => { candidates.forEach(c => c.checked = true); renderCandidates(); };
					bar.append(btnAll, el("span", "nks-hint", "勾选后 Import 抓取全文导入;「预览」即时查看正文"), btnImp);
					sResults.appendChild(bar);
					const list = el("div");
					for (const c of candidates) {
						const item = el("div", "nks-cand");
						const row = el("div", "row");
						const cb = el("input"); cb.type = "checkbox"; cb.checked = c.checked;
						cb.onchange = () => { c.checked = cb.checked; btnImp.textContent = `Import 选中(${candidates.filter(x => x.checked).length})`; };
						const main = el("div", "main");
						// 标题行:标题(单行省略) + 发布日期徽标
						const trow = el("div", "trow");
						trow.appendChild(el("div", "t", c.title));
						if (c.publishedAt) {
							const d = String(c.publishedAt).slice(0, 10);
							trow.appendChild(el("span", "date", d));
						}
						main.appendChild(trow);
						// 域名行:domain + 路径(截断),完整 URL 放悬浮提示
						let path = "";
						try { path = new URL(c.url).pathname; } catch { /* 忽略 */ }
						if (path.length > 42) path = path.slice(0, 42) + "…";
						const u = el("div", "u", path ? `${c.domain}${path}` : c.url);
						u.title = c.url;
						main.appendChild(u);
						// 摘要:两行截断
						main.appendChild(el("div", "s", c.snippet || ""));
						row.append(cb, main);
						// 预览按钮:即时抓取正文
						const btnPv = el("button", "sm ghost pv", "预览");
						btnPv.onclick = async (ev) => {
							ev.stopPropagation();
							btnPv.disabled = true; btnPv.textContent = "抓取中…";
							try { const p = await api("POST", "/preview-url", { url: c.url }); openUrlPreview(p); }
							catch (e) { toast("预览失败: " + e.message, true); }
							btnPv.disabled = false; btnPv.textContent = "预览";
						};
						row.appendChild(btnPv);
						item.appendChild(row);
						list.appendChild(item);
					}
					sResults.appendChild(list);
					btnImp.textContent = `Import 选中(${candidates.filter(x => x.checked).length})`;
					btnImp.onclick = async () => {
						const urls = candidates.filter(c => c.checked).map(c => c.url);
						if (!urls.length) return toast("先勾选候选来源", true);
						btnImp.disabled = true; btnImp.textContent = "抓取导入中…";
						try {
							const r = await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/import-urls`, { urls });
							const okN = r.results.filter(x => x.status === "ok").length;
							const dupN = r.results.filter(x => x.status === "duplicate").length;
							const errN = r.results.filter(x => x.status === "error").length;
							toast(`导入完成:成功 ${okN},重复 ${dupN},失败 ${errN}`);
							await loadDetail();
							overlay.remove();
						} catch (e) { toast("导入失败: " + e.message, true); }
						btnImp.disabled = false;
					};
				}

				function handleSourceResult(r) {
					if (r.status === "duplicate") {
						toast(`内容重复:${r.message}`, true);
					} else if (r.status === "multimodal-pending") {
						toast("已登记多模态来源(待 Qwen-MM 转写)——在对话中让 agent 调用 qwen-mm 工具转写并 nb_source_update 写回");
					} else {
						toast(`已导入: ${r.title}`);
					}
					loadDetail();
				}

				bd.append(tabs, paneFile, paneUrl, paneText, paneSearch);
				box.append(hd, bd);
				overlay.appendChild(box);
				overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };
				root.appendChild(overlay);
			}

			btnAdd.onclick = openAddModal;
			btnNew.onclick = () => {
				openForm(root, {
					title: "新建 Notebook",
					fields: [{ key: "title", label: "标题", type: "text" }],
					submitText: "创建",
					onSubmit: async (v) => {
						if (!v.title.trim()) return toast("请输入标题", true);
						try { const nb = await api("POST", "/notebooks", { title: v.title }); state.currentId = nb.id; await refreshNotebooks(); toast(`已创建: ${nb.title}`); }
						catch (e) { toast("创建失败: " + e.message, true); }
					},
				})
			};
			btnDel.onclick = () => {
				if (!state.currentId) return;
				openConfirm(root, `删除 Notebook「${state.currentId}」及其全部来源与 Studio 产物?此操作不可恢复。`, async () => {
					try { await api("POST", `/notebooks/${encodeURIComponent(state.currentId)}/delete`, { confirm: true }); state.currentId = null; await refreshNotebooks(false); toast("已删除"); }
					catch (e) { toast("删除失败: " + e.message, true); }
				})
			};
			sel.onchange = () => { state.currentId = sel.value || null; loadDetail(); btnDel.style.display = state.currentId ? "" : "none"; btnActivate.style.display = state.currentId ? "" : "none"; };

			refreshNotebooks();
			container.appendChild(root);
			const applyWidth = () => {
				root.classList.toggle("nks-narrow", (root.clientWidth || 0) < 720)
				applyCols()
			};
			applyWidth();
			window.addEventListener("resize", applyWidth);
			return function cleanup() {
				window.removeEventListener("resize", applyWidth);
				try { root.remove(); style.remove(); } catch { /* noop */ }
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
