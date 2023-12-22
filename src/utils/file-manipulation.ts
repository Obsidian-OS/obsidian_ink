import { Notice, TFile, Vault } from "obsidian";
import { DRAW_FILE_EXT, FOLDER_NAME, WRITE_FILE_EXT } from "src/constants";
import InkPlugin from "src/main";
import { PageData } from "./page-file";
import { isNonNullish } from "@tldraw/tldraw";



const getNewTimestampedFilepath = async (plugin: InkPlugin, ext: string) => {
    const date = new Date();
    let minutes = date.getMinutes().toString();
    let hours = date.getHours();
    let suffix = 'am';

    if(hours>12) {
        hours = hours-12;
        suffix = 'pm';
    }
    if(minutes.length<2) minutes = '0' + minutes;

    let filename = date.getFullYear() + '.' + date.getMonth() + '.' + date.getDate() + ' - ' + hours + '.' + minutes + suffix;

    const pathAndBasename = FOLDER_NAME + '/' + filename;
    let version = 1;
    let pathAndVersionedBasename = pathAndBasename;

    while( await plugin.app.vault.adapter.exists(`${pathAndVersionedBasename}.${ext}`) ) {
        version ++;
		pathAndVersionedBasename = pathAndBasename + ' (' + version + ')';
    }

    return pathAndVersionedBasename + '.' + ext;
}
export const getNewTimestampedWritingFilepath = async (plugin: InkPlugin) => {
    return getNewTimestampedFilepath(plugin, WRITE_FILE_EXT);
}
export const getNewTimestampedDrawingFilepath = async (plugin: InkPlugin) => {
    return getNewTimestampedFilepath(plugin, DRAW_FILE_EXT);
}


export const convertWriteFileToDraw = async (plugin: InkPlugin, file: TFile) => {
    if(file.extension !== WRITE_FILE_EXT) return;
    const v = plugin.app.vault;

    const pageDataStr = await v.read(file as TFile);
    const pageData = JSON.parse(pageDataStr) as PageData;

    // Remove the page container from the file
    if(pageData.tldraw.store['shape:primary_container']){
        delete pageData.tldraw.store['shape:primary_container'];
        await v.modify(file, JSON.stringify(pageData));
    }

    let folderPath = '';
    if(file.parent) {
        folderPath = file.parent.path + '/';
    }
    const newPath = folderPath + file.basename + '.' + DRAW_FILE_EXT;
    await v.rename(file, newPath);
}



export const duplicateDrawingFile = async (plugin: InkPlugin, existingFilepath: string): Promise<TFile | null> => {
    const v = plugin.app.vault;

    const existingFile = v.getAbstractFileByPath(existingFilepath);
    if(!(existingFile instanceof TFile)) {
        new Notice('No file found to duplicate');
        return null;
    }

    const newFilePath = await getNewTimestampedDrawingFilepath(plugin);
    const newFile = await v.copy(existingFile, newFilePath);

    return newFile;
}


export const duplicateWritingFile = async (plugin: InkPlugin, existingFilepath: string): Promise<TFile | null> => {
    const v = plugin.app.vault;

    const existingFile = v.getAbstractFileByPath(existingFilepath);
    if(!(existingFile instanceof TFile)) {
        new Notice('No file found to duplicate');
        return null;
    }

    const newFilePath = await getNewTimestampedWritingFilepath(plugin);
    const newFile = await v.copy(existingFile, newFilePath);

    return newFile;
}