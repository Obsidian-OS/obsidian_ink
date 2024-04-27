import { UnlockIcon } from "src/graphics/icons/unlock-icon";
import "./transition-menu.scss";
import * as React from "react";
import { OverflowIcon } from "src/graphics/icons/overflow-icon";
import OverflowButton from "../overflow-button/overflow-button";

//////////
//////////

export const TransitionMenu: React.FC<{
	onEditClick: Function,
	overflowOptions: any[],
}> = (props) => {

	return <>
		<div
            className = 'ink_transition_menu'
        >
            <button
                onClick = {() => props.onEditClick()}
            >
                <UnlockIcon/>
            </button>
            <OverflowButton
                menuOptions = {props.overflowOptions}
            />
        </div>
	</>

};

export default TransitionMenu;