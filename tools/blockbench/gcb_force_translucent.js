// GCB Force Translucent (26.x) — Blockbench 플러그인
// 26.x 리소스팩의 객체형 textures({"sprite": "...", "force_translucent": true})를 자바 모델 코덱이 읽고 쓰게 한다.
// 열 때: 객체 → 문자열로 바꿔 넘기고 플래그는 텍스처 속성(force_translucent)에 기억.
// 내보낼 때: 플래그가 켜진 텍스처는 다시 객체형으로 쓴다. 텍스처 우클릭 메뉴에 토글 추가.
(function () {
	const codec = Codecs.java_block;
	let origParse, property, action, compileListener;

	function flagged(key) {
		const tex = Texture.all.find(t => t.id == key);
		return tex && tex.force_translucent;
	}

	Plugin.register('gcb_force_translucent', {
		title: 'GCB Force Translucent (26.x)',
		author: 'GCB',
		icon: 'opacity',
		description: '26.x 팩의 textures 객체형(force_translucent)을 자바 모델에서 읽고 쓰게 합니다.',
		version: '1.0.0',
		variant: 'both',
		onload() {
			property = new Property(Texture, 'boolean', 'force_translucent', { default: false });

			origParse = codec.parse;
			codec.parse = function (model, path, args) {
				const flags = {};
				if (model && model.textures) {
					for (const key in model.textures) {
						const v = model.textures[key];
						if (v && typeof v === 'object' && typeof v.sprite === 'string') {
							flags[key] = !!v.force_translucent;
							model.textures[key] = v.sprite;
						}
					}
				}
				const result = origParse.call(this, model, path, args);
				for (const key in flags) {
					Texture.all.forEach(t => { if (t.id == key) t.force_translucent = flags[key]; });
				}
				return result;
			};

			compileListener = codec.on('compile', ({ model }) => {
				if (!model || !model.textures) return;
				for (const key in model.textures) {
					const v = model.textures[key];
					if (typeof v !== 'string' || v.startsWith('#')) continue;
					const particleOf = key == 'particle' && Texture.all.find(t => t.particle);
					if (flagged(key) || (particleOf && particleOf.force_translucent)) {
						model.textures[key] = { sprite: v, force_translucent: true };
					}
				}
			});

			action = new Action('gcb_toggle_force_translucent', {
				name: 'Force Translucent (26.x) 토글',
				description: '이 텍스처를 쓰는 면을 항상 반투명 시트로 (틴트 투명도 조절용)',
				icon: 'opacity',
				condition: () => Texture.selected,
				click() {
					const tex = Texture.selected;
					if (!tex) return;
					tex.force_translucent = !tex.force_translucent;
					Blockbench.showQuickMessage(`${tex.name}: force_translucent ${tex.force_translucent ? 'ON' : 'OFF'}`, 1500);
					Project.saved = false;
				}
			});
			Texture.prototype.menu.addAction(action);
		},
		onunload() {
			if (origParse) codec.parse = origParse;
			if (compileListener) compileListener.delete();
			if (action) action.delete();
			if (property) property.delete();
		}
	});
})();
