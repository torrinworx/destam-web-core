
export default () => {
    return {
        init: (msg, sync) => {
            console.log(sync);
            console.log(msg);
            console.log("AUTHENTICATED");
        }
    }
};
