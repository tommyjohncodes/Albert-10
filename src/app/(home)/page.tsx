 "use client";

import Image from "next/image";
import { useUser } from "@clerk/nextjs";

import { HomeSidebar } from "@/modules/home/ui/components/home-sidebar";
import { ProjectForm } from "@/modules/home/ui/components/project-form";
import { ProjectsList } from "@/modules/home/ui/components/projects-list";

const Page = () => {
  const { user } = useUser();
  const firstName = user?.firstName ?? "there";
  return (
    <div className="flex flex-1 w-full -mx-4 flex-col md:flex-row">
      <HomeSidebar />
      <div className="flex-1 px-4 md:pl-72">
        <div className="flex flex-col max-w-5xl mx-auto w-full">
          <section className="space-y-6 py-[16vh] 2xl:py-48">
            <div className="flex flex-col items-center">
              <Image
                src="/albert-logo.png"
                alt="Vibe"
                width={50}
                height={50}
                className="hidden md:block"
              />
            </div>
            <h1 className="text-xl md:text-4xl font-bold text-center">
              What do you want to build today, {firstName}?
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground text-center">
              Create apps and websites by chatting with AI
            </p>
            <div className="max-w-3xl mx-auto w-full">
              <ProjectForm />
            </div>
          </section>
          <ProjectsList />
        </div>
      </div>
    </div>
  );
};
 
export default Page;
