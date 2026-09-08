import { useRef } from "react";
import { IRefPhaserGame, PhaserGame } from "./PhaserGame";
import "./App.css";

import BetWidgetSidebar from "./react-components/bet-widget-sidebar";
import Logo from "./react-components/logo";

function App() {
    //  References to the PhaserGame component (game and scene are exposed)
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    return (
        <div id="app">
            <div className="w-full h-full flex flex-col-reverse gap-3 justify-start lg:flex-row items-center justify-center">
                <BetWidgetSidebar />
                <div
                    id="game-container"
                    className=" fixed top-0 left-0 lg:ml-[30%] w-[100%] h-[50%] lg:h-[100%] lg:w-[70%] "
                >
                    <PhaserGame ref={phaserRef} />
                </div>
            </div>
            <Logo />
        </div>
    );
}

export default App;
