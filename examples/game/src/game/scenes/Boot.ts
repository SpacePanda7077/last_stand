import { Scene } from "phaser";
import { EventBus } from "../EventBus";

async function loadFont() {
    await document.fonts.load('32px "Permanent Marker"');
}

export class Boot extends Scene {
    constructor() {
        super("Boot");
    }

    preload() {
        this.load.setPath("assets");
        loadFont();
        this.load.image("bg", "outer_bg.png");
        this.load.spritesheet("ms1", "characters/ms1/ms1.png", {
            frameWidth: 128,
            frameHeight: 128,
        });
        this.load.spritesheet(
            "ms1_hand_down",
            "characters/ms1/ms1_hand_down.png",
            {
                frameWidth: 32,
                frameHeight: 32,
            },
        );
        this.load.spritesheet(
            "ms1_hand_shoot",
            "characters/ms1/ms1_hand_shoot.png",
            {
                frameWidth: 32,
                frameHeight: 32,
            },
        );
        this.load.spritesheet("board", "board.png", {
            frameWidth: 50,
            frameHeight: 100,
        });
        this.load.audio("bg_sound", "sounds/bg_sound.mp3");
        this.load.audio("gun_sound", "sounds/gun_sound.mp3");
        for (let i = 0; i < 3; i++) {
            this.load.image(`splat_${i}`, `splats/splat_${i}.png`);
        }
    }

    create() {
        EventBus.emit("current-scene-ready", this);
        this.scene.start("Game");
        this.input.on("pointerdown", () => {
            // this.sound.add("bg_sound").play({ loop: true });
        });
    }
}

