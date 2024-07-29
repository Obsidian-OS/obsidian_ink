import './tldraw-drawing-editor.scss';
import { Editor, HistoryEntry, StoreSnapshot, TLRecord, TLUiOverrides, Tldraw } from "@tldraw/tldraw";
import { useRef } from "react";
import { Activity, adaptTldrawToObsidianThemeMode, getActivityType, initDrawingCamera, prepareDrawingSnapshot, preventTldrawCanvasesCausingObsidianGestures } from "../../utils/tldraw-helpers";
import InkPlugin from "../../main";
import * as React from "react";
import { svgToPngDataUri } from 'src/utils/screenshots';
import { TFile } from 'obsidian';
import { savePngExport } from "src/utils/savePngExport";
import { duplicateWritingFile, rememberDrawingFile } from "src/utils/rememberDrawingFile";
import { InkFileData, buildDrawingFileData } from 'src/utils/page-file';
import { DRAW_SHORT_DELAY_MS, DRAW_LONG_DELAY_MS } from 'src/constants';
import { PrimaryMenuBar } from '../primary-menu-bar/primary-menu-bar';
import DrawingMenu from '../drawing-menu/drawing-menu';
import ExtendedDrawingMenu from '../extended-drawing-menu/extended-drawing-menu';
import { openInkFile } from 'src/utils/open-file';

///////
///////

export enum tool {
	select = 'select',
	draw = 'draw',
	eraser = 'eraser',
}

const myOverrides: TLUiOverrides = {}

export function TldrawDrawingEditor(props: {
	onReady?: Function,
	plugin: InkPlugin,
	fileRef: TFile,
	pageData: InkFileData,
	save: (pageData: InkFileData) => void,

	// For embeds
	embedded?: boolean,
	registerControls?: Function,
	resizeEmbedContainer?: (pxHeight: number) => void,
	closeEditor?: Function,
	commonExtendedOptions: any[]
}) {
	// const assetUrls = getAssetUrlsByMetaUrl();
	const shortDelayPostProcessTimeoutRef = useRef<NodeJS.Timeout>();
	const longDelayPostProcessTimeoutRef = useRef<NodeJS.Timeout>();
	const editorRef = useRef<Editor>();
	const [curTool, setCurTool] = React.useState<tool>(tool.draw);
	const [canUndo, setCanUndo] = React.useState<boolean>(false);
	const [canRedo, setCanRedo] = React.useState<boolean>(false);
	const [storeSnapshot] = React.useState<StoreSnapshot<TLRecord>>(prepareDrawingSnapshot(props.pageData.tldraw))

	function undo() {
		const editor = editorRef.current
		if (!editor) return;
		editor.undo();
	}
	function redo() {
		const editor = editorRef.current
		if (!editor) return;
		editor.redo();
	}
	function activateSelectTool() {
		const editor = editorRef.current
		if (!editor) return;
		editor.setCurrentTool('select');
		setCurTool(tool.select);

	}
	function activateDrawTool() {
		const editor = editorRef.current
		if (!editor) return;
		editor.setCurrentTool('draw');
		setCurTool(tool.draw);
	}
	function activateEraseTool() {
		const editor = editorRef.current
		if (!editor) return;
		editor.setCurrentTool('eraser');
		setCurTool(tool.eraser);
	}
	
	const handleMount = (_editor: Editor) => {
		const editor = editorRef.current = _editor;

		// General setup
		preventTldrawCanvasesCausingObsidianGestures(editor);

		// tldraw content setup
		adaptTldrawToObsidianThemeMode(editor);
		editor.updateInstanceState({
			isDebugMode: false,
			// isGridMode: true,	// REVIEW: Turned off for now because it forces snapping
		})
		
		// view setup
		initDrawingCamera(editor);
		activateDrawTool();
		if (props.embedded) {
			editor.updateInstanceState({ canMoveCamera: false })
		}

		// Runs on any USER caused change to the store, (Anything wrapped in silently change method doesn't call this).
		const removeUserActionListener = editor.store.listen((entry) => {

			const activity = getActivityType(entry);
			switch (activity) {
				case Activity.PointerMoved:
					// TODO: Consider whether things are being erased
					break;

				case Activity.CameraMovedAutomatically:
				case Activity.CameraMovedManually:
					break;

				case Activity.DrawingStarted:
					resetInputPostProcessTimers();
					break;

				case Activity.DrawingContinued:
					resetInputPostProcessTimers();
					break;

				case Activity.DrawingCompleted:
					instantInputPostProcess(editor, entry);
					embedPostProcess(editor);
					smallDelayInputPostProcess(editor);
					longDelayInputPostProcess(editor);
					break;

				case Activity.DrawingErased:
					embedPostProcess(editor);	// REVIEW: This could go inside a post process
					instantInputPostProcess(editor, entry);
					smallDelayInputPostProcess(editor);
					longDelayInputPostProcess(editor);
					break;

				default:
					// Catch anything else not specifically mentioned (ie. erase, draw shape, etc.)
					instantInputPostProcess(editor, entry);
					smallDelayInputPostProcess(editor);
					longDelayInputPostProcess(editor);
					// console.log('Activity not recognised.');
					// console.log('entry', JSON.parse(JSON.stringify(entry)) );
			}

		}, {
			source: 'user',	// Local changes
			scope: 'all'	// Filters some things like camera movement changes. But Not sure it's locked down enough, so leaving as all.
		})

		// Runs on any change to the store, caused by user, system, undo, anything, etc.
		const removeStoreChangeListener = editor.store.listen((entry) => {
			setCanUndo(editor.getCanUndo());
			setCanRedo(editor.getCanRedo());
		})

		const unmountActions = () => {
			// NOTE: This prevents the postProcessTimer completing when a new file is open and saving over that file.
			resetInputPostProcessTimers();
			removeUserActionListener();
			removeStoreChangeListener();
		}

		if(props.registerControls) {
			props.registerControls({
				save: () => completeSave(editor),
				saveAndHalt: async (): Promise<void> => {
					await completeSave(editor)
					unmountActions();	// Clean up immediately so nothing else occurs between this completeSave and a future unmount
				},
			})
		}
		
		if(props.onReady) props.onReady()

		return () => {
			unmountActions();
		};
	}

	const embedPostProcess = (editor: Editor) => {
		// resizeContainerIfEmbed(editor);
	}

	// Use this to run optimisations that that are quick and need to occur immediately on lifting the stylus
	const instantInputPostProcess = (editor: Editor, entry?: HistoryEntry<TLRecord>) => {
		// simplifyLines(editor, entry);
	};

	// Use this to run optimisations that take a small amount of time but should happen frequently
	const smallDelayInputPostProcess = (editor: Editor) => {
		resetShortPostProcessTimer();

		shortDelayPostProcessTimeoutRef.current = setTimeout(
			() => {
				incrementalSave(editor);
			},
			DRAW_SHORT_DELAY_MS
		)

	};

	// Use this to run optimisations after a slight delay
	const longDelayInputPostProcess = (editor: Editor) => {
		resetLongPostProcessTimer();

		longDelayPostProcessTimeoutRef.current = setTimeout(
			() => {
				completeSave(editor);
			},
			DRAW_LONG_DELAY_MS
		)

	};

	const resetShortPostProcessTimer = () => {
		clearTimeout(shortDelayPostProcessTimeoutRef.current);
	}
	const resetLongPostProcessTimer = () => {
		clearTimeout(longDelayPostProcessTimeoutRef.current);
	}
	const resetInputPostProcessTimers = () => {
		resetShortPostProcessTimer();
		resetLongPostProcessTimer();
	}

	const incrementalSave = async (editor: Editor) => {
		const tldrawData = editor.store.getSnapshot();

		const pageData = buildDrawingFileData({
			tldrawData,
			previewIsOutdated: true,
		})
		props.save(pageData);
	}

	const completeSave = async (editor: Editor): Promise<void> => {
		let previewUri;

		const tldrawData = editor.store.getSnapshot();
		const svgObj = await getDrawingSvg(editor);

		if (svgObj) {
			previewUri = svgObj.svg;//await svgToPngDataUri(svgObj)
			// if(previewUri) addDataURIImage(previewUri)	// NOTE: Option for testing
		}
		
		if(previewUri) {
			const pageData = buildDrawingFileData({
				tldrawData,
				previewUri,
			})
			props.save(pageData);
			// savePngExport(props.plugin, previewUri, props.fileRef)

		} else {
			const pageData = buildDrawingFileData({
				tldrawData,
			})
			props.save(pageData);
		}

		return;
	}

	// TODO: Assets
	// const assetUrls = {
	// 	icons: {
	// 		'tool-hand': './custom-tool-hand.svg',
	// 	},
	// }

	//////////////

	return <>
		<div
			className = "ddc_ink_drawing-editor"
			style = {{
				height: '100%',
				position: 'relative'
			}}
		>
			<Tldraw
				snapshot = {storeSnapshot}
				onMount = {handleMount}
				// persistenceKey = {props.filepath}
				// assetUrls = {assetUrls}
				// shapeUtils={MyCustomShapes}
				overrides = {myOverrides}
				hideUi // REVIEW: Does this do anything?
				// NOTE: False prevents tldraw scrolling the page to the top of the embed when turning on.
				// But a side effect of false is preventing mousewheel scrolling and zooming.
				autoFocus = {props.embedded ? false : true}
			/>
			<PrimaryMenuBar>
				<DrawingMenu
					canUndo = {canUndo}
					canRedo = {canRedo}
					curTool = {curTool}
					onUndoClick = {undo}
					onRedoClick = {redo}
					onSelectClick = {activateSelectTool}
					onDrawClick = {activateDrawTool}
					onEraseClick = {activateEraseTool}
				/>
				{props.embedded && (
					<ExtendedDrawingMenu
						onLockClick = { async () => {
							// TODO: Save immediately incase it hasn't been saved yet?
							if(props.closeEditor) props.closeEditor();
						}}
						menuOptions = {props.commonExtendedOptions}
					/>
				)}
			</PrimaryMenuBar>
		</div>
	</>;

};

//////////
//////////

interface svgObj {
	height: number,
	width: number,
	svg: string,
};

async function getDrawingSvg(editor: Editor): Promise<svgObj | undefined> {
	const allShapeIds = Array.from(editor.getCurrentPageShapeIds().values());
	const svgObj = await editor.getSvgString(allShapeIds);
	return svgObj;
}