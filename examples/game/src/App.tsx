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
            <div className="w-full h-full backdrop-blur-md ">
                <div className="phaser-cont fixed top-0 lg:top-1/2 lg:-translate-y-1/2 left-0 w-full h-[50%] lg:h-[95%] lg:w-[70%] flex  items-center border-4 border-[#FABC34]">
                    <PhaserGame ref={phaserRef} />
                </div>
            </div>

            <BetWidgetSidebar />

            <Logo />
        </div>
    );
}

export default App;
