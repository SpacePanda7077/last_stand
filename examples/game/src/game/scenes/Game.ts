import { Scene, Math as PhaserMaths } from "phaser";
import { EventBus } from "../EventBus";
import { Player } from "../components/Player/Player";

export class Game extends Scene {
    playerArray: Player[] = [];

    lostEffect: Phaser.GameObjects.Rectangle;
    r_board: Phaser.GameObjects.Image;
    l_board: Phaser.GameObjects.Image;
    multiplierText: Phaser.GameObjects.Text;
    statusText: Phaser.GameObjects.Text;
    multiplier: number;
    r_n_board: Phaser.GameObjects.Image;
    l_n_board: Phaser.GameObjects.Image;
    notificationText: Phaser.GameObjects.Text;
    startText: Phaser.GameObjects.Text;

    constructor() {
        super("Game");
    }

    preload() {
        this.load.setPath("assets");
    }

    create() {
        const centerX = this.scale.width * 0.5;
        const centerY = this.scale.height * 0.5;
        const radius = 400;
        const count = 10;
        this.cameras.main.setZoom(0.6);

        this.lostEffect = this.add
            .rectangle(
                centerX,
                centerY,
                this.scale.width,
                this.scale.height,
                0xff0000,
                0.5,
            )
            .setDepth(100000)
            .setVisible(false)
            .setScale(2);
        this.add.image(centerX, centerY, "bg").setScale(1.5).setDepth(-1000000);
        if (!this.sound.isPlaying("bg_sound")) {
            this.sound.add("bg_sound").play({ loop: true, volume: 0.4 });
        }

        this.playerArray = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;

            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            const player = new Player(
                this,
                x,
                y,
                Math.PI + angle,
                "ms1",
                this.playerArray,
                i + 1,
            );
            this.playerArray.push(player);
        }

        this.handle_events();
        this.add_board();
        this.add_notification_board();
        this.startText = this.add
            .text(
                this.scale.width * 0.5,
                this.scale.height * 0.5,
                `Pick A 
                Survivor`,
                {
                    fontFamily: "Permanent Marker",
                    fontSize: "128px",
                    color: "#ff0000",
                    stroke: "black",
                    strokeThickness: 15,
                },
            )
            .setOrigin(0.5)
            .setDepth(100000000000);
        this.startText.enableFilters().filters?.external.addShadow();
        this.tweens.add({
            targets: this.startText,
            scale: 1.1,
            duration: 1800,
            yoyo: true,
            repeat: -1,
        });

        EventBus.emit("current-scene-ready", this);
    }

    handle_events() {
        // Defensive: strip any listener left over from a previous create()
        // call (HMR reload, scene restart) before adding a fresh one.
        EventBus.off("survivor_choosen", this.onSurvivorChosen, this);
        EventBus.on("survivor_choosen", this.onSurvivorChosen, this);

        EventBus.off("round-result", this.onRoundResult, this);
        EventBus.on("round-result", this.onRoundResult, this);
        EventBus.off("play_again", this.onPlayAgain, this);
        EventBus.on("play_again", this.onPlayAgain, this);
        EventBus.off("decision", this.onDecisionMade, this);
        EventBus.on("decision", this.onDecisionMade, this);
        EventBus.off("show_notification", this.onNotification, this);
        EventBus.on("show_notification", this.onNotification, this);
    }

    onSurvivorChosen = (picked: number[]) => {
        this.startText.setVisible(false);
        console.log(picked);
        this.playerArray.forEach((p) => {
            p.choose_circle.setVisible(false);
        });
        for (const i of picked) {
            this.playerArray[i].choose_circle.setVisible(true);
        }
    };

    onRoundResult = (data: {
        dead: boolean;
        eliminatedPlayer: number;
        remainingPlayers: number[];
        selectedPlayer: number;
    }) => {
        console.log(data);
        if (!data) return;

        // The contract pushes an intermediate state right after "Continue"
        // with contractPick = 0 (randomness not resolved yet). Ignore it —
        // only animate once a real contractPick has come back.
        if (data.dead) {
            this.playerArray[data.selectedPlayer].die(this);
        }

        const index = PhaserMaths.Between(0, data.remainingPlayers.length);
        const shooter = this.playerArray[data.remainingPlayers[index]];
        if (!shooter) return;

        const target = this.playerArray[data.eliminatedPlayer];
        if (!target) return;

        shooter.hand_down_body.setVisible(false);
        shooter.hand_shoot_body.setVisible(true);

        this.sound.play("gun_sound", { volume: 0.3 });

        const targetAngle = PhaserMaths.Angle.Between(
            shooter.body.x,
            shooter.body.y,
            target.body.x,
            target.body.y,
        );
        shooter.shoot(targetAngle);
        target.die(this);
    };
    onPlayAgain = () => {
        this.scene.restart();
    };

    onDecisionMade = (data: {
        won: boolean;
        eliminatedPlayers: number[]; // 1-based (1-10)
        picks: number[]; // 0-based (0-9)  ← important
        currentMultiplier: number;
    }) => {
        this.startText.setVisible(false);
        console.log("decision data:", data);
        const eliminatedplayers = data.eliminatedPlayers;
        this.multiplier = data.won ? data.currentMultiplier : 0;

        const all_players = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let index = 0;

        const remainingPlayers = all_players.filter(
            (player) => !data.eliminatedPlayers.includes(player),
        );

        console.log(remainingPlayers);
        // -------------------------------------------------
        // Animation loop
        // -------------------------------------------------
        const t = this.time.addEvent({
            delay: 1000,
            callback: () => {
                const shooterIndex = PhaserMaths.Between(
                    0,
                    remainingPlayers.length - 1,
                );
                const shooter =
                    this.playerArray[remainingPlayers[shooterIndex] - 1];
                const e = eliminatedplayers[index];
                console.log("Player Index : ", e + 1);
                const target = this.playerArray[e];
                this.sound.play("gun_sound", { volume: 0.3 });
                const angle = PhaserMaths.Angle.Between(
                    shooter.body.x,
                    shooter.body.y,
                    target.body.x,
                    target.body.y,
                );
                shooter.shoot(angle);

                target.die(this);
                if (data.picks.includes(e)) {
                    this.lostEffect.setVisible(true);
                    this.cameras.main.shake(100, 0.02);
                    this.tweens.add({
                        targets: this.lostEffect,
                        alpha: { from: 0, to: 0.5 },
                        duration: 700,
                    });
                    this.show_score();
                    EventBus.emit("settled", this.multiplier);
                    t.destroy();
                }
                index++;
                if (index === eliminatedplayers.length && data.won) {
                    this.show_score();
                    this.statusText.setColor("green").setText("You Won !!!");
                    this.multiplierText.setColor("green");
                    EventBus.emit("settled", this.multiplier);
                }
            },
            repeat: Math.max(0, data.eliminatedPlayers.length - 1),
        });
    };
    onNotification = (text: string) => {
        this.notificationText.setText(text);
        this.show_notification();
    };

    shutdown() {
        EventBus.off("survivor_choosen", this.onSurvivorChosen, this);
        EventBus.off("round-result", this.onRoundResult, this);
        EventBus.off("play_again", this.onPlayAgain, this);
        EventBus.off("decision", this.onDecisionMade, this);
        EventBus.off("show_notification", this.onNotification, this);
    }
    add_board() {
        this.r_board = this.add
            .image(10000, this.scale.height * 0.5, "board", 1)
            .setScale(10)
            .setOrigin(0, 0.5)
            .setDepth(100000000000);
        this.l_board = this.add
            .image(-10000, this.scale.height * 0.5, "board")
            .setScale(10)
            .setOrigin(1, 0.5)
            .setDepth(100000000000);

        this.statusText = this.add
            .text(
                this.scale.width * 0.5,
                this.scale.height * 0.35,
                "You Lost",
                {
                    fontFamily: "Permanent Marker",
                    fontSize: "64px",
                    color: "#ff0000",
                    stroke: "black",
                    strokeThickness: 15,
                },
            )
            .setOrigin(0.5)
            .setDepth(100000000000)
            .setVisible(false);

        this.multiplierText = this.add
            .text(this.scale.width * 0.5, this.scale.height * 0.5, "0.00 x", {
                fontFamily: "Permanent Marker",
                fontSize: "96px",
                color: "#ff0000",
                stroke: "black",
                strokeThickness: 15,
                letterSpacing: 10,
            })
            .setOrigin(0.5)
            .setDepth(100000000000000)
            .setVisible(false);
    }
    add_notification_board() {
        this.r_n_board = this.add
            .image(10000, this.scale.height * 0.5, "board", 1)
            .setScale(10)
            .setOrigin(0, 0.5)
            .setDepth(100000000000);
        this.l_n_board = this.add
            .image(-10000, this.scale.height * 0.5, "board")
            .setScale(10)
            .setOrigin(1, 0.5)
            .setDepth(100000000000);

        this.notificationText = this.add
            .text(this.scale.width * 0.5, this.scale.height * 0.5, "You Lost", {
                fontFamily: "Permanent Marker",
                fontSize: "64px",
                color: "#ff0000",
                stroke: "black",
                strokeThickness: 15,
            })
            .setOrigin(0.5)
            .setDepth(100000000000)
            .setVisible(false);
    }

    show_score() {
        this.tweens.chain({
            targets: this.r_board,
            tweens: [
                {
                    x: this.scale.width * 0.5,
                    duration: 300,
                    onComplete: () => {
                        this.cameras.main.shake(100, 0.02);
                        this.statusText.setVisible(true);
                        this.multiplierText.setVisible(true);
                        const counter = { value: 0 };
                        this.tweens.add({
                            targets: this.multiplierText,
                            alpha: 0.5,
                            duration: 1000,
                            yoyo: true,
                            repeat: -1,
                        });

                        this.tweens.add({
                            targets: counter,
                            value: this.multiplier.toFixed(2),
                            duration: 500,
                            ease: "Cubic.easeOut",

                            onUpdate: () => {
                                this.multiplierText.setText(
                                    `${counter.value.toFixed(2)} x`,
                                );
                            },
                        });
                    },
                },
                {
                    x: this.scale.width * 0.5,
                    duration: 3000,
                },
            ],
        });

        this.tweens.chain({
            targets: this.l_board,
            tweens: [
                {
                    x: this.scale.width * 0.5,
                    duration: 300,
                },
                {
                    x: this.scale.width * 0.5,
                    duration: 3000,
                },
            ],
        });
    }
    show_notification() {
        this.tweens.chain({
            targets: this.r_n_board,
            tweens: [
                {
                    x: this.scale.width * 0.5,
                    duration: 300,
                    onComplete: () => {
                        this.cameras.main.shake(100, 0.02);

                        this.notificationText.setVisible(true);
                        //this.multiplierText.setVisible(true);
                    },
                },
                {
                    x: this.scale.width * 0.5,
                    duration: 1500,
                    onComplete: () => {
                        this.notificationText.setVisible(false);
                    },
                },
                {
                    x: this.scale.width * 0.65,
                    y: 50,
                    duration: 200,
                    angle: 30,
                },
                {
                    x: this.scale.width * 0.85,
                    y: this.scale.height * 1.5,
                    duration: 300,
                    angle: 30,
                },
            ],
        });

        this.tweens.chain({
            targets: this.l_n_board,
            tweens: [
                {
                    x: this.scale.width * 0.5,
                    duration: 300,
                    onComplete: () => {
                        this.cameras.main.shake(100, 0.02);
                        //this.statusText.setVisible(true);
                        //this.multiplierText.setVisible(true);
                    },
                },
                {
                    x: this.scale.width * 0.5,
                    duration: 1500,
                },
                {
                    x: this.scale.width * 0.45,
                    y: 50,
                    duration: 200,
                    angle: -30,
                },
                {
                    x: this.scale.width * 0.15,
                    y: this.scale.height * 1.5,
                    duration: 300,
                    angle: -30,
                    onComplete: () => {
                        this.l_n_board
                            .setPosition(-100000, this.scale.height * 0.5)
                            .setAngle(0);
                        this.r_n_board
                            .setPosition(100000, this.scale.height * 0.5)
                            .setAngle(0);
                    },
                },
            ],
        });
    }
}
