import { GameObjects, Scene, Math as PhaserMaths } from "phaser";

export class Player {
    body: GameObjects.Container;
    shadow: GameObjects.Ellipse;
    stack_imgs: GameObjects.Image[] = [];
    head_stack_imgs: GameObjects.Image[] = [];
    hand_down_body: GameObjects.Container;
    r = 0;
    hand_shoot_body: GameObjects.Container;
    head: GameObjects.Container;
    position: number;
    positionText: GameObjects.Text;
    choose_circle: GameObjects.Arc;
    constructor(
        scene: Scene,
        x: number,
        y: number,
        angle: number,
        texture: string,
        playerArray: Player[],
        position: number,
    ) {
        this.position = position;
        this.create(scene, x, y, angle, texture);

        //this.lookAt(scene, playerArray);
        scene.time.addEvent({
            delay: 4000,
            callback: () => this.lookAt(scene, playerArray),
            loop: true,
        });
    }
    create(scene: Scene, x: number, y: number, angle: number, texture: string) {
        this.choose_circle = scene.add
            .circle(x, y, 100, 0xff0000, 0.5)
            .setStrokeStyle(10, 0xff0000)
            .setVisible(false)
            .setDepth(-10000);
        this.body = scene.add.container(x, y);
        this.hand_down_body = scene.add.container(0, 0);
        this.hand_shoot_body = scene.add.container(0, 0);

        const frameCount =
            scene.textures.get(texture).getFrameNames().length - 1;
        console.log("angle : ", angle);
        this.shadow = scene.add
            .ellipse(x, y, 60, 80, 0x000000, 0.4)
            .setRotation(angle)
            .setDepth(-100);
        for (let i = 0; i < frameCount - 9; i++) {
            const img = scene.add
                .sprite(0, i * -2, texture, i)
                .setScale(2)
                .setRotation(angle);
            this.body.add(img);
            this.stack_imgs.push(img);
        }
        this.add_right_hand(scene, x, y, angle, texture);
        this.add_left_hand(scene, x, y, angle, texture);
        this.add_shoot_hand(scene, x, y, angle, texture);
        this.hand_down_body.setVisible(true);
        this.hand_shoot_body.setVisible(false);
        this.add_head(scene, x, y, angle, texture);

        scene.tweens.add({
            targets: this.choose_circle,
            scale: 1.1,
            duration: 1000,
            yoyo: true,
            repeat: -1,
        });
    }

    add_head(
        scene: Scene,
        x: number,
        y: number,
        angle: number,
        texture: string,
    ) {
        const frameCount =
            scene.textures.get(texture).getFrameNames().length - 1;
        const start = frameCount - 9;
        const count = frameCount - start;
        this.head = scene.add.container(x, y - start * 2);

        for (let i = 0; i < count; i++) {
            const img = scene.add
                .sprite(0, i * -2, texture, start + i)
                .setScale(2)
                .setRotation(angle);
            this.head.add(img);
            this.head_stack_imgs.push(img);
        }
    }

    add_right_hand(
        scene: Scene,
        x: number,
        y: number,
        angle: number,
        texture: string,
    ) {
        const offset = 50;

        // Right side of player
        const posx = x + Math.cos(angle + Math.PI / 2) * offset;
        const posy = y + Math.sin(angle + Math.PI / 2) * offset;

        const cont = scene.add.container(posx, posy);

        const handFrameCount =
            scene.textures.get(`${texture}_hand_down`).getFrameNames().length -
            1;

        for (let i = 0; i < handFrameCount; i++) {
            const img = scene.add
                .sprite(0, i * -2, `${texture}_hand_down`, i)
                .setScale(5)
                .setRotation(angle);
            cont.add(img);
        }

        this.hand_down_body.add(cont);
    }
    add_left_hand(
        scene: Scene,
        x: number,
        y: number,
        angle: number,
        texture: string,
    ) {
        const offset = 50;

        // Left side of player
        const posx = x + Math.cos(angle - Math.PI / 2) * offset;
        const posy = y + Math.sin(angle - Math.PI / 2) * offset;

        const cont = scene.add.container(posx, posy);

        const handFrameCount =
            scene.textures.get(`${texture}_hand_down`).getFrameNames().length -
            1;

        for (let i = 0; i < handFrameCount; i++) {
            const img = scene.add
                .sprite(0, i * -2, `${texture}_hand_down`, i)
                .setScale(5)
                .setRotation(angle)
                .setFlipX(false)
                .setFlipY(true);

            cont.add(img);
        }
        this.hand_down_body.add(cont);
    }
    add_shoot_hand(
        scene: Scene,
        x: number,
        y: number,
        angle: number,
        texture: string,
    ) {
        const offset = 50;
        const posx = x + Math.cos(angle) * offset;
        const posy = y + Math.sin(angle) * offset;
        this.hand_shoot_body.setPosition(posx, posy);

        const handFrameCount =
            scene.textures.get(`${texture}_hand_shoot`).getFrameNames().length -
            1;

        for (let i = 0; i < handFrameCount; i++) {
            const img = scene.add
                .sprite(0, i * -2, `${texture}_hand_shoot`, i)
                .setScale(5)
                .setRotation(angle)
                .setFlipX(false)
                .setFlipY(true);

            this.hand_shoot_body.add(img); // add directly — no intermediate container
        }

        const numberx = x + Math.cos(angle) * -100;
        const numbery = y + Math.sin(angle) * -100;
        this.positionText = scene.add
            .text(numberx, numbery, this.position.toString(), {
                fontStyle: "bold",
                fontSize: "48px",
                color: "red",
                stroke: "black",
                strokeThickness: 8,
            })
            .setOrigin(0.5)

            .setRotation(Math.PI / 2 + angle);
    }

    lookAt(scene: Scene, playerArray: Player[]) {
        const others = playerArray.filter((p) => p !== this);
        if (others.length === 0) return;

        const target = others[Math.floor(Math.random() * others.length)];

        const targetAngle = PhaserMaths.Angle.Between(
            this.body.x,
            this.body.y,
            target.body.x,
            target.body.y,
        );

        const currentAngle = this.head_stack_imgs[0].rotation;
        const angleDifference = PhaserMaths.Angle.Wrap(
            targetAngle - currentAngle,
        );
        const finalAngle = currentAngle + angleDifference;

        scene.tweens.add({
            targets: this.head_stack_imgs[0],
            rotation: finalAngle,
            duration: 1000,
            onUpdate: () => {
                this.head_stack_imgs.forEach((i) => {
                    i.rotation = this.head_stack_imgs[0].rotation;
                });
            },
        });
    }
    shoot(angle: number) {
        this.stack_imgs.forEach((img) => {
            img.setRotation(angle);
        });
        this.head_stack_imgs.forEach((img) => {
            img.setRotation(angle);
        });
        this.hand_down_body.setVisible(false);
        this.hand_shoot_body.setVisible(true);

        const offset = 50;

        // Left side of player
        const posx = this.body.x + Math.cos(angle) * offset;
        const posy = this.body.y + Math.sin(angle) * offset;
        this.hand_shoot_body.setPosition(posx, posy);
        const list = this.hand_shoot_body.list as GameObjects.Image[];
        list.forEach((img) => {
            img.setRotation(angle);
        });
    }
    die(scene: Scene) {
        this.hand_down_body.setVisible(false);
        this.body.setVisible(false);
        this.head.setVisible(false);
        this.shadow.setVisible(false);
        this.positionText.setVisible(false);
        const splat = scene.add.image(
            this.body.x,
            this.body.y,
            `splat_${PhaserMaths.Between(0, 2)}`,
        );
        splat.setTint(0xff0000);
    }
    reAssign(number: number) {
        this.position = number;
        this.positionText.text = number.toString();
    }
}

