// Scene IDs are stable within a story: revisiting a location keeps its ID/color.
window.CineLongPrompts = (() => {
  const locations = [
    [/reception area/i, "Office Reception"],
    [/manager's office/i, "Manager’s Office"],
    [/small-town square/i, "Town Square"],
    [/clock tower/i, "Clock Tower"],
    [/deserted back alley/i, "Back Alley"],
    [/vast control room/i, "Control Room"],
    [/sparse room of an old house/i, "Storm-lit Parlor"],
    [/wide grassy plain/i, "Grassy Plain"],
    [/courtyard.*Greek island/i, "Greek Island · Villa Courtyard"]
  ];

  function scenes(prompts, names) {
    const seen = [];
    let previous;
    return prompts.map((prompt, index) => {
      const setting = prompt.match(/The scene takes place[^.]+\./)?.[0] || "";
      const title = names?.[index] || locations.find(([pattern]) => pattern.test(setting))?.[1] || setting || "Scene";
      const revisited = seen.includes(title) && previous !== title;
      if (!seen.includes(title)) seen.push(title);
      const number = seen.indexOf(title) + 1;
      previous = title;
      return { title, number, color: (number - 1) % 8, revisited };
    });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function sceneLabel(meta) {
    return `Scene ${String(meta.number).padStart(2, "0")}`;
  }

  function badge(meta) {
    const tag = element("span", "scene-tag", `${sceneLabel(meta)} · ${meta.title}`);
    tag.dataset.sceneColor = meta.color;
    return tag;
  }

  function renderScene(container, meta) {
    container.className = "scene-banner";
    container.dataset.sceneColor = meta.color;
    container.replaceChildren(
      element("span", "scene-eyebrow", sceneLabel(meta)),
      element("strong", "scene-location", meta.title)
    );
    if (meta.revisited) container.append(element("span", "scene-return", "↩ Return to this location"));
  }

  function block(container, label, text, className = "") {
    if (!text?.trim()) return;
    const section = element("section", `prompt-block ${className}`);
    section.append(element("h5", "prompt-label", label));
    for (const line of text.trim().split(/\n+/)) section.append(element("p", "", line.trim()));
    container.append(section);
    return section;
  }

  // Split at sentence boundaries, keeping decimal timestamps and dialogue intact.
  function sentences(text) {
    return text.match(/[^.!?]+(?:[.!?]+["”]?|$)/g)?.map(s => s.trim()).filter(Boolean) || [];
  }

  function shotBody(container, text) {
    // Only separate explicit speech; retain action/audio wording in source order.
    const dialogue = /(?:<Subject \d+>\s*\(S\d+\)|Subject \d+)\s+[^.!?\n]*?(?:<d>[\s\S]*?<\/d>|"[^"]*"[.!?]?)/g;
    let cursor = 0;
    for (const match of text.matchAll(dialogue)) {
      const before = text.slice(cursor, match.index).trim();
      if (before) container.append(element("p", "", before));
      const quote = element("div", "prompt-dialogue");
      quote.append(element("span", "prompt-label", "Dialogue"), element("p", "", match[0]));
      container.append(quote);
      cursor = match.index + match[0].length;
    }
    const remaining = text.slice(cursor).trim();
    if (remaining) container.append(element("p", "", remaining));
  }

  function renderShots(container, text) {
    const markers = [...text.matchAll(/\[Shot \d+\]|The video begins with|At \d{2}:\d{2}\.\d{3},/g)];
    if (!markers.length) { block(container, "Action", text); return; }
    if (markers[0].index > 0) block(container, "Transition", text.slice(0, markers[0].index));
    markers.forEach((marker, index) => {
      // Structured prompts already include [Shot] markers, so do not split again at timestamps.
      const content = text.slice(marker.index, markers[index + 1]?.index ?? text.length).trim();
      const section = element("section", "prompt-block prompt-shot");
      const time = content.match(/\d{2}:\d{2}\.\d{3}/)?.[0] || (index === 0 ? "00:00.000" : "");
      section.append(element("h5", "prompt-label", `Shot ${index + 1}${time ? " · " + time : ""}`));
      shotBody(section, content.replace(/^\[Shot \d+\]\s*/, ""));
      container.append(section);
    });
  }

  function render(container, prompt) {
    container.classList.add("formatted-prompt");
    container.replaceChildren();
    if (prompt.includes("subject_definitions:")) {
      const fields = [...prompt.matchAll(/(?:^|\n)(\w+):\s*/g)];
      const data = Object.fromEntries(fields.map((m,i) => [m[1], prompt.slice(m.index + m[0].length, fields[i+1]?.index ?? prompt.length).trim()]));
      block(container, "Scene setting", data.scene_setting);
      block(container, "Characters", data.subject_definitions);
      // The source's explicit shot markers delimit this structured format.
      const shots = data.integrated_multimodal_description?.split(/(?=\[Shot \d+\])/).filter(Boolean) || [];
      shots.forEach((shot, i) => {
        const section = element("section", "prompt-block prompt-shot");
        const time = shot.match(/\d{2}:\d{2}\.\d{3}/)?.[0];
        section.append(element("h5", "prompt-label", `Shot ${i + 1}${time ? " · " + time : ""}`));
        shotBody(section, shot.replace(/^\[Shot \d+\]\s*/, ""));
        container.append(section);
      });
      block(container, "Soundscape", data.overall_soundscape);
      block(container, "Music", data.non_diegetic_music);
      block(container, "Continuity", data.chunk_continuity);
      const known = new Set(["scene_setting", "subject_definitions", "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music", "chunk_continuity"]);
      for (const [key, value] of Object.entries(data)) if (!known.has(key)) block(container, key.replaceAll("_", " "), value);
    } else if (prompt.includes("The video begins with")) {
      const start = prompt.indexOf("The video begins with");
      const context = { Transition: [], "Scene setting": [], Characters: [], "Visual style": [] };
      for (const sentence of sentences(prompt.slice(0, start))) {
        const label = /^Subject \d+ is/.test(sentence) ? "Characters" : /^The video is/.test(sentence) ? "Visual style" : /^The opening shot/.test(sentence) ? "Transition" : "Scene setting";
        context[label].push(sentence);
      }
      for (const label of ["Scene setting", "Characters", "Visual style", "Transition"]) block(container, label, context[label].join("\n"));
      renderShots(container, prompt.slice(start));
    } else {
      block(container, "Action", prompt);
    }
    container.scrollTop = 0;
  }
  return { scenes, badge, renderScene, render };
})();
