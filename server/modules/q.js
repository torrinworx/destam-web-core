export default () => {
    return {
        onMsgQ: async ({ test }) => {
            console.log("Starting the processing of the queue item.");

            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log("This is a queue item running in the queue. This is test param: ", test);
        }
    };
};
